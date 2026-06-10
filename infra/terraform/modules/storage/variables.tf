variable "environment" {
  type = string
}

variable "audit_bucket_name" {
  type = string
}

variable "backup_bucket_name" {
  type = string
}

variable "worm_retention_days" {
  type    = number
  default = 2555
}
