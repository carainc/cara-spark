variable "region" {
  description = "AWS region (cara-prod demo = us-east-1)."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 type. t3.large (8GB) so the Next image builds on-box without OOM."
  type        = string
  default     = "t3.large"
}

variable "repo_url" {
  description = "Public git repo the instance clones."
  type        = string
  default     = "https://github.com/carainc/cara-spark.git"
}

variable "branch" {
  description = "Branch to deploy."
  type        = string
  default     = "epic/fable5-build"
}

variable "project_tag" {
  description = "Isolation tag — every resource is project=cara-spark (NEVER prod)."
  type        = string
  default     = "cara-spark"
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH (debug). Tighten for non-demo use."
  type        = string
  default     = "0.0.0.0/0"
}

variable "key_name" {
  description = "Optional EC2 key pair name for SSH debugging. Empty = no SSH key."
  type        = string
  default     = ""
}

// --- Voice firewall (IP-allowlist auth — the standalone box's only firewall layer) ---

variable "sip_signaling_cidrs" {
  description = <<-EOT
    CIDRs allowed to send SIP signaling (UDP 5060). Carrier signaling ranges only — do NOT open
    to 0.0.0.0/0 (toll-fraud scanning). Default = Telnyx US signaling /24s
    (primary 192.76.120.0/24, secondary 64.16.250.0/24).
  EOT
  type        = list(string)
  default     = ["192.76.120.0/24", "64.16.250.0/24"]
}

variable "rtp_media_cidrs" {
  description = <<-EOT
    CIDRs allowed for inbound RTP media (UDP 10000-10100). Carrier media ranges. Default = the
    Telnyx US signaling /24s (media often shares them); widen to your carrier's media ranges if
    audio is one-way after SIP connects.
  EOT
  type        = list(string)
  default     = ["192.76.120.0/24", "64.16.250.0/24"]
}
