# Terraform — Clinical Copilot Infrastructure

Provider-agnostic Terraform skeleton. Activate the relevant cloud provider block for your deployment environment.

## Modules

| Module | Provisions |
|---|---|
| `postgres` | Managed PostgreSQL (RDS / self-managed PVC) |
| `storage` | S3-compatible buckets (audit WORM, DB backup) |
| `k8s` | Namespace, RBAC, NetworkPolicies |

## Usage

```bash
cd infra/terraform

# Initialize
terraform init

# Plan for a specific environment
terraform plan \
  -var="environment=staging" \
  -var="audit_bucket_name=clinical-copilot-audit-staging" \
  -var="backup_bucket_name=clinical-copilot-backup-staging"

# Apply
terraform apply ...
```

## Secrets

Database passwords and API keys are never stored in Terraform state. Use:
- AWS: RDS `manage_master_user_password = true` (Secrets Manager integration)
- Self-managed: K8s Secret populated by Vault / external-secrets
