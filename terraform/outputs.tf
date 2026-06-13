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

output "spark_url" {
  value = "https://spark.caramedical.com"
}

output "spark_nameservers" {
  description = "Delegate spark.caramedical.com to these NS records at the caramedical.com apex."
  value       = aws_route53_zone.spark.name_servers
}

output "spark_google_redirect" {
  description = "Add to the Google OAuth client once spark.caramedical.com resolves + TLS is issued."
  value       = "https://spark.caramedical.com/api/auth/callback/google"
}
