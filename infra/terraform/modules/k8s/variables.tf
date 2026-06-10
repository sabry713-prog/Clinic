variable "environment" {
  type = string
}

variable "namespace" {
  type    = string
  default = "clinical-copilot-prod"
}

variable "prometheus_namespace" {
  type    = string
  default = "monitoring"
}
