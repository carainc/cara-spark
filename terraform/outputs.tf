output "public_ip" {
  value = aws_eip.this.public_ip
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

output "ssh" {
  value = "ssh ec2-user@${aws_eip.this.public_ip}  # bootstrap log: /var/log/cara-spark-bootstrap.log"
}
