variable "environment" {
  type = string
}

variable "db_name" {
  type    = string
  default = "clinical_copilot"
}

variable "db_username" {
  type    = string
  default = "clinical_copilot_app"
}

variable "storage_size_gb" {
  type    = number
  default = 100
}

variable "instance_class" {
  type    = string
  default = "db.t3.large"
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

variable "allowed_cidr_blocks" {
  type    = list(string)
  default = []
}
