# Runbook: High Error Rate

**Alert**: `HighErrorRate` — HTTP error rate > 1% over a 5-minute window
**Severity**: SEV-2
**Recipient**: On-call engineer

## What this means

More than 1% of HTTP requests to the `core` service are returning 5xx status codes over the last 5 minutes. This indicates a systemic failure — not a single user issue. At 1% of typical load this is ~30 errors per minute. Likely causes: a broken upstream dependency (database, OIDC, FHIR endpoint, or Python sidecar), a bad deploy, or resource exhaustion.

## First 5 minutes

1. **Check which endpoints are failing**:
   ```
   Grafana → Overview dashboard → Error rate by path
   ```
2. **Check application logs** for exception stack traces:
   ```bash
   kubectl logs -n clinical-copilot-prod -l app.kubernetes.io/component=core --since=10m | grep '"level":"error"'
   ```
3. **Check database connectivity**:
   ```bash
   kubectl exec -n clinical-copilot-prod <core-pod> -- node -e "const pg=require('pg'); ..."
   # Or check the db_query_duration_seconds histogram for spikes
   ```
4. **Check upstream services** (OIDC, FHIR, narrative, qa):
   ```bash
   kubectl logs -n clinical-copilot-prod -l app.kubernetes.io/component=narrative --since=5m
   kubectl logs -n clinical-copilot-prod -l app.kubernetes.io/component=qa --since=5m
   ```
5. **Check recent deployments** and correlate with the start of the error surge:
   ```bash
   kubectl rollout history deployment/clinical-copilot-core -n clinical-copilot-prod
   ```

## Escalation path

1. On-call engineer (immediate)
2. If not resolved in 30 min: engineering lead
3. If error rate > 5% for > 15 min: escalate to SEV-1 and notify hospital IT

## Related dashboards

- Overview: [Grafana /d/overview](http://grafana.hospital.local/d/overview)
- Error rate by path: [Grafana /d/overview?var-panel=error_rate](http://grafana.hospital.local/d/overview)
