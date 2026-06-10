# Clinical Copilot — Terraform root module
#
# Provider selection: This configuration uses provider-agnostic resource
# patterns. The actual cloud provider (AWS, Azure, GCP, on-premises Kubernetes)
# is selected per hospital deployment by enabling the appropriate provider block
# in provider.tf (not included here to avoid accidental targeting of a specific
# cloud). The modules below accept provider-agnostic variable inputs.
#
# See variables.tf for all configurable inputs.
# See outputs.tf for exported values.

terraform {
  required_version = ">= 1.7.0"
  required_providers {
    # Uncomment and configure the provider for your deployment:
    # aws = {
    #   source  = "hashicorp/aws"
    #   version = "~> 5.0"
    # }
    # azurerm = {
    #   source  = "hashicorp/azurerm"
    #   version = "~> 3.0"
    # }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }

  # Remote state backend — configure per deployment
  # backend "s3" {
  #   bucket = "clinical-copilot-tfstate"
  #   key    = "clinical-copilot/terraform.tfstate"
  #   region = "me-south-1"   # Bahrain (nearest in-Kingdom AWS region)
  #   encrypt = true
  # }
}

# ── PostgreSQL ────────────────────────────────────────────────────────────────
module "postgres" {
  source = "./modules/postgres"

  environment          = var.environment
  db_name              = var.db_name
  db_username          = var.db_username
  storage_size_gb      = var.db_storage_size_gb
  instance_class       = var.db_instance_class
  backup_retention_days = var.db_backup_retention_days
  allowed_cidr_blocks  = var.db_allowed_cidr_blocks
}

# ── Object storage ────────────────────────────────────────────────────────────
module "storage" {
  source = "./modules/storage"

  environment          = var.environment
  audit_bucket_name    = var.audit_bucket_name
  backup_bucket_name   = var.backup_bucket_name
  worm_retention_days  = var.worm_retention_days
}

# ── Kubernetes RBAC and network policies ──────────────────────────────────────
module "k8s" {
  source = "./modules/k8s"

  environment       = var.environment
  namespace         = var.k8s_namespace
  prometheus_namespace = var.prometheus_namespace
}
