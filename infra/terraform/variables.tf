variable "environment" {
  description = "Deployment environment label (dev / staging / prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod"
  }
}

# ── Database ──────────────────────────────────────────────────────────────────
variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "clinical_copilot"
}

variable "db_username" {
  description = "PostgreSQL superuser username (password via secrets manager)"
  type        = string
  default     = "clinical_copilot_app"
}

variable "db_storage_size_gb" {
  description = "PostgreSQL storage size in GiB"
  type        = number
  default     = 100
}

variable "db_instance_class" {
  description = "Database instance class / VM size (provider-specific string)"
  type        = string
  default     = "db.t3.large"  # example AWS; adjust per provider
}

variable "db_backup_retention_days" {
  description = "Number of days to retain automated database backups"
  type        = number
  default     = 30
}

variable "db_allowed_cidr_blocks" {
  description = "CIDR blocks permitted to connect to the database (K8s node CIDR)"
  type        = list(string)
  default     = []
}

# ── Object storage ────────────────────────────────────────────────────────────
variable "audit_bucket_name" {
  description = "Name of the WORM-locked bucket for audit log exports"
  type        = string
}

variable "backup_bucket_name" {
  description = "Name of the bucket for database backups"
  type        = string
}

variable "worm_retention_days" {
  description = "Object Lock retention period for audit exports (days)"
  type        = number
  default     = 2555  # 7 years for regulatory compliance
}

# ── Kubernetes ────────────────────────────────────────────────────────────────
variable "k8s_namespace" {
  description = "Kubernetes namespace for Clinical Copilot workloads"
  type        = string
  default     = "clinical-copilot-prod"
}

variable "prometheus_namespace" {
  description = "Namespace where Prometheus is deployed (for NetworkPolicy)"
  type        = string
  default     = "monitoring"
}
