output "public_ip" {
  description = "The box's Elastic IP. This is BOTH the SIP signaling target AND the RTP media IP."
  value       = aws_eip.this.public_ip
}

output "hostname" {
  value = "${aws_eip.this.public_ip}.sslip.io"
}

output "url" {
  description = "Live HTTPS URL (Caddy auto-TLS via sslip.io)."
  value       = "https://${aws_eip.this.public_ip}.sslip.io"
}

output "google_redirect_uri" {
  description = "Add this to the SAME Google OAuth web client so the super-admin can sign in."
  value       = "https://${aws_eip.this.public_ip}.sslip.io/api/auth/callback/google"
}

output "livekit_nat_1_to_1_ip" {
  description = "Set this as LIVEKIT_NAT_1_TO_1_IP (user_data does it automatically) — the media-path quirk."
  value       = aws_eip.this.public_ip
}

output "telnyx_fqdn_target" {
  description = <<-EOT
    Point the EXISTING Telnyx connection's FQDN at this for standalone inbound (zero new spend —
    no new DID). Set default_primary_fqdn_id, DTMF=RFC2833, inbound.codecs=[G711U,G711A].
  EOT
  value       = "${aws_eip.this.public_ip}:5060 (UDP)"
}

output "ssh" {
  value = "ssh ec2-user@${aws_eip.this.public_ip}  # bootstrap log: /var/log/cara-spark-bootstrap.log"
}
