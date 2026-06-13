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
