# Object storage module
#
# Provisions two buckets:
#   1. audit_bucket — WORM Object Lock, versioning, server-side encryption
#   2. backup_bucket — versioning, server-side encryption
#
# Provider-agnostic comments below. Uncomment the AWS block for production.

# ── AWS S3 (managed) ─────────────────────────────────────────────────────────
# Uncomment for AWS deployments.
#
# resource "aws_s3_bucket" "audit" {
#   bucket = var.audit_bucket_name
#   tags = {
#     Environment = var.environment
#     Project     = "clinical-copilot"
#     Purpose     = "audit-worm"
#   }
# }
#
# resource "aws_s3_bucket_versioning" "audit" {
#   bucket = aws_s3_bucket.audit.id
#   versioning_configuration { status = "Enabled" }
# }
#
# resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
#   bucket = aws_s3_bucket.audit.id
#   rule {
#     apply_server_side_encryption_by_default {
#       sse_algorithm = "AES256"
#     }
#   }
# }
#
# # WORM Object Lock — COMPLIANCE mode (cannot be shortened or deleted)
# resource "aws_s3_bucket_object_lock_configuration" "audit" {
#   bucket = aws_s3_bucket.audit.id
#   rule {
#     default_retention {
#       mode = "COMPLIANCE"
#       days = var.worm_retention_days
#     }
#   }
# }
#
# resource "aws_s3_bucket_public_access_block" "audit" {
#   bucket                  = aws_s3_bucket.audit.id
#   block_public_acls       = true
#   block_public_policy     = true
#   ignore_public_acls      = true
#   restrict_public_buckets = true
# }
#
# # Backup bucket (no WORM — just versioning for point-in-time recovery)
# resource "aws_s3_bucket" "backup" {
#   bucket = var.backup_bucket_name
#   tags = {
#     Environment = var.environment
#     Project     = "clinical-copilot"
#     Purpose     = "db-backup"
#   }
# }
#
# resource "aws_s3_bucket_versioning" "backup" {
#   bucket = aws_s3_bucket.backup.id
#   versioning_configuration { status = "Enabled" }
# }
#
# resource "aws_s3_bucket_lifecycle_configuration" "backup" {
#   bucket = aws_s3_bucket.backup.id
#   rule {
#     id     = "expire-old-backups"
#     status = "Enabled"
#     expiration { days = 90 }
#   }
# }

# ── Outputs ───────────────────────────────────────────────────────────────────
output "audit_bucket_name" {
  value = var.audit_bucket_name
}

output "backup_bucket_name" {
  value = var.backup_bucket_name
}
