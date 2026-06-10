output "db_endpoint" {
  description = "PostgreSQL connection endpoint (host:port)"
  value       = module.postgres.endpoint
  sensitive   = true
}

output "audit_bucket_name" {
  description = "WORM audit export bucket name"
  value       = module.storage.audit_bucket_name
}

output "backup_bucket_name" {
  description = "Database backup bucket name"
  value       = module.storage.backup_bucket_name
}

output "k8s_namespace" {
  description = "Kubernetes namespace created for the workloads"
  value       = module.k8s.namespace
}
