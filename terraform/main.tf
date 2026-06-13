// Cara Spark — standalone voice box: single EC2 + SG + EIP running docker-compose (runbook §G).
//
// THE STANDALONE SIMPLIFICATION (why this is NOT the prod EKS maze): containers bind host ports
// directly, so the EC2 Security Group is the ONLY firewall layer and the caller's IP is preserved
// natively. No NLB instance-targets, no NodePort, no externalTrafficPolicy, no health-check
// blackhole. The Elastic IP is BOTH the SIP signaling address AND the RTP media address — which is
// exactly why LiveKit needs `nat_1_to_1_ip = <EIP>` (set in the box's env; see user_data + outputs).
//
// ISOLATION (hard rule): every resource is tagged project=cara-spark and is ALL-NEW. This NEVER
// touches the prod LiveKit stack (EKS ns livekit, line +14157180498, trunk ST_ogz3uBxbodYp,
// rule SDR_zBaUyhWXoddU, cara-realtime/cara-cascade, the Telnyx FQDN conn).
// NO Telnyx DID is created here — a new DID needs a top-up (a human gate). The demo runs on the
// existing +14157180498 fallback rung pointed at this box's EIP (zero new spend).
//
// SECRETS NOTE: .env is injected (base64) via user-data → present in the instance user-data + the
// tfstate (both gitignored). Acceptable for a throwaway demo box; rotate keys after Build Day.
// Hardening path: SSM Parameter Store instead of user-data .env injection.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      project   = var.project_tag
      ManagedBy = "terraform"
      component = "cara-spark-standalone-voice"
    }
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

// The single firewall layer. Single-VM = caller IP preserved; no NLB/NodePort indirection.
resource "aws_security_group" "this" {
  name_prefix = "cara-spark-"
  description = "cara-spark standalone voice box (NOT prod livekit). Single-VM = the only firewall layer."
  vpc_id      = data.aws_vpc.default.id
  tags        = { Name = "cara-spark-voice" }

  ingress {
    description = "ssh (debug)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }
  ingress {
    description = "http (Caddy ACME + redirect)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "https (Caddy → app)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  // SIP signaling. IP-ALLOWLIST AUTH: scope to your carrier's signaling ranges. Default = Telnyx US
  // signaling /24s (var.sip_signaling_cidrs). Tighten/replace for your trunk. NOT 0.0.0.0/0 — SIP
  // open to the world invites toll-fraud scanning.
  ingress {
    description = "sip signaling (carrier IP-allowlist)"
    from_port   = 5060
    to_port     = 5060
    protocol    = "udp"
    cidr_blocks = var.sip_signaling_cidrs
  }
  // RTP media. Carrier media ranges. Default Telnyx US media /24s (var.rtp_media_cidrs). Keep this
  // range in sync with rtp_port_range_* in config/sip.yaml.
  ingress {
    description = "rtp media (carrier media ranges)"
    from_port   = 10000
    to_port     = 10100
    protocol    = "udp"
    cidr_blocks = var.rtp_media_cidrs
  }
  // LiveKit WebRTC (browser/SDK media). Open for the kiosk/web path.
  ingress {
    description = "livekit rtc udp"
    from_port   = 50000
    to_port     = 50100
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

// Allocate the EIP FIRST so user-data knows both the public hostname (<eip>.sslip.io for TLS) AND
// the nat_1_to_1_ip the LiveKit media path requires.
resource "aws_eip" "this" {
  domain = "vpc"
  tags   = { Name = "cara-spark-voice" }
}

resource "aws_instance" "this" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.this.id]
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url      = var.repo_url
    branch        = var.branch
    hostname      = "${aws_eip.this.public_ip}.sslip.io"
    nat_1_to_1_ip = aws_eip.this.public_ip
    # Inject the BYO-key .env (base64). It is gitignored + lives next to this module on the
    # operator's machine. `try(..., "")` keeps `terraform validate` green when .env is absent
    # (e.g. CI / a clean clone); `apply` requires a real .env so the box boots configured.
    env_b64 = try(filebase64("${path.module}/../.env"), "")
  })
  user_data_replace_on_change = true

  tags = { Name = "cara-spark-voice" }
}

resource "aws_eip_association" "this" {
  instance_id   = aws_instance.this.id
  allocation_id = aws_eip.this.id
}
