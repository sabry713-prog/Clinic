# Runbook: Service Down

**Alert**: `ServiceDown` — health check fails 3 consecutive times for any pod
**Severity**: SEV-1 (patient-facing service) / SEV-2 (internal component)
**Recipient**: On-call engineer + Hospital IT (SEV-1); on-call only (SEV-2)

## What this means

A Kubernetes liveness or readiness probe has failed three times in a row, causing the pod to be restarted or removed from load-balancing rotation. The corresponding service (`core`, `narrative`, `qa`, or `web`) may be partially or fully unavailable to users. If `core` is down, all clinical functions are unavailable; if `qa` is down, only Q&A is unavailable (patient view and narrative continue working).

## First 5 minutes

1. **Check pod status** in the affected namespace:
   ```bash
   kubectl get pods -n clinical-copilot-prod -l app.kubernetes.io/component=<service>
   ```
2. **Read recent logs** from the failing pod:
   ```bash
   kubectl logs -n clinical-copilot-prod <pod-name> --previous --tail=200
   ```
3. **Check events** for OOM kills, image pull failures, or node pressure:
   ```bash
   kubectl describe pod -n clinical-copilot-prod <pod-name>
   ```
4. **Check resource pressure** on the node:
   ```bash
   kubectl top node
   kubectl top pod -n clinical-copilot-prod
   ```
5. **Check recent deployments**: was a new image pushed in the last hour?
   ```bash
   kubectl rollout history deployment/<service> -n clinical-copilot-prod
   ```

## Escalation path

1. On-call engineer (immediate)
2. If not resolved in 15 min: engineering lead
3. If `core` service down > 30 min: Hospital IT notification
4. If related to a recent deploy: trigger rollback immediately

## Rollback procedure

```bash
kubectl rollout undo deployment/clinical-copilot-<service> -n clinical-copilot-prod
kubectl rollout status deployment/clinical-copilot-<service> -n clinical-copilot-prod
```

## Related dashboards

- Overview dashboard: [Grafana /d/overview](http://grafana.hospital.local/d/overview)
- Kubernetes pods panel: [Grafana /d/k8s-pods](http://grafana.hospital.local/d/k8s-pods)
