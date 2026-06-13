// Cara Spark — single EC2 + SG + EIP running docker-compose (the AWS demo, runbook §4.5/§G).
// ISOLATION (hard rule): every resource is tagged project=cara-spark and is ALL-NEW. This NEVER
// touches the prod LiveKit stack (EKS ns livekit, line +14157180498, trunk ST_ogz3uBxbodYp,
// cara-realtime/cara-cascade). No Telnyx DID is created here (that needs a top-up gate — Lane G).
//
// SECRETS NOTE: .env is injected (base64) via user-data → present in the instance user-data + tfstate
// (both gitignored). Acceptable for a throwaway demo box; removed on teardown. Rotate keys after Build
// Day. T13 can harden to SSM Parameter Store.

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
      component = "cara-spark-standalone-demo"
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

resource "aws_security_group" "this" {
  name_prefix = "cara-spark-"
  description = "cara-spark standalone demo (NOT prod livekit). Single-VM = the only firewall layer."
  vpc_id      = data.aws_vpc.default.id
  tags        = { Name = "cara-spark-demo" }

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
    description = "https (Caddy to app)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "sip signaling"
    from_port   = 5060
    to_port     = 5060
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "rtp media"
    from_port   = 10000
    to_port     = 10100
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
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

// SSM Session Manager — headless box access (no SSH key, no inbound port) for deploy debugging + redeploy.
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name_prefix        = "cara-spark-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = { Name = "cara-spark-demo" }
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "this" {
  name_prefix = "cara-spark-"
  role        = aws_iam_role.this.name
}

// Allocate the EIP first so user-data knows the public hostname (<eip>.sslip.io) for TLS + AUTH_URL.
resource "aws_eip" "this" {
  domain = "vpc"
  tags   = { Name = "cara-spark-demo" }
}

resource "aws_instance" "this" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.this.id]
  iam_instance_profile   = aws_iam_instance_profile.this.name
  key_name               = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url = var.repo_url
    branch   = var.branch
    hostname = "spark.caramedical.com"
    eip_host = "${aws_eip.this.public_ip}.sslip.io"
    # The raw Elastic IP — injected into .env as LIVEKIT_NAT_1_TO_1_IP so LiveKit advertises the
    # public address on the RTP/ICE path (the single-VM 1:1-NAT media quirk). See user_data.sh.tftpl.
    eip     = aws_eip.this.public_ip
    env_b64 = base64encode(file("${path.module}/../.env"))
  })
  user_data_replace_on_change = true

  tags = { Name = "cara-spark-demo" }
}

resource "aws_eip_association" "this" {
  instance_id   = aws_instance.this.id
  allocation_id = aws_eip.this.id
}

// spark.caramedical.com — the demo subdomain. NS delegation at the caramedical.com apex is a one-time
// external step (see the spark_nameservers output). Until delegated, the deploy uses the sslip.io host.
resource "aws_route53_zone" "spark" {
  name = "spark.caramedical.com"
  tags = { Name = "cara-spark-demo" }
}

resource "aws_route53_record" "spark_a" {
  zone_id = aws_route53_zone.spark.zone_id
  name    = "spark.caramedical.com"
  type    = "A"
  ttl     = 300
  records = [aws_eip.this.public_ip]
}
