# PostgreSQL module
#
# Provider-agnostic: the actual resource type depends on the cloud provider.
# Uncomment the relevant block for your deployment.
#
# This module provisions a managed PostgreSQL instance with:
#   - Encryption at rest
#   - Automated backups (retention: var.backup_retention_days)
#   - Deletion protection enabled
#   - No public access

# ── Kubernetes PVC (self-managed PostgreSQL) ──────────────────────────────────
# Suitable for on-premises / bare-metal deployments.

resource "kubernetes_persistent_volume_claim" "postgres_data" {
  metadata {
    name      = "clinical-copilot-postgres-${var.environment}"
    namespace = "clinical-copilot-${var.environment}"
    labels = {
      "app.kubernetes.io/name"      = "postgres"
      "app.kubernetes.io/component" = "database"
      "environment"                 = var.environment
    }
  }
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "${var.storage_size_gb}Gi"
      }
    }
    # Use the cluster's default StorageClass unless the deployer specifies
    # storage_class_name = "premium-rwo"
  }
}

# ── AWS RDS (managed) ─────────────────────────────────────────────────────────
# Uncomment for AWS deployments and configure the aws provider.
#
# resource "aws_db_instance" "postgres" {
#   identifier        = "clinical-copilot-${var.environment}"
#   engine            = "postgres"
#   engine_version    = "16"
#   instance_class    = var.instance_class
#   allocated_storage = var.storage_size_gb
#   db_name           = var.db_name
#   username          = var.db_username
#   # Password from Secrets Manager — never hardcoded
#   manage_master_user_password = true
#
#   backup_retention_period = var.backup_retention_days
#   backup_window           = "02:00-03:00"
#   maintenance_window      = "Mon:03:00-Mon:04:00"
#
#   storage_encrypted = true
#   deletion_protection = true
#   publicly_accessible = false
#   skip_final_snapshot = false
#   final_snapshot_identifier = "clinical-copilot-${var.environment}-final"
#
#   tags = {
#     Environment = var.environment
#     Project     = "clinical-copilot"
#   }
# }

output "endpoint" {
  description = "Database endpoint"
  # value = aws_db_instance.postgres.endpoint   # for AWS
  value = "postgres.clinical-copilot-${var.environment}.svc.cluster.local:5432"
  sensitive = true
}
