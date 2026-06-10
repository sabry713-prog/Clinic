# Runbook: External Model Unreachable

**Alert**: `ExternalModelUnreachable` — model API endpoint unreachable for > 1 minute
**Severity**: SEV-2 (HIGH)
**Recipient**: On-call engineer

## What this means

The application cannot reach the Anthropic Claude API endpoint (in-Kingdom deployment). Q&A (for allowed questions) and Narrative generation will fail with 503 errors. The classifier still works (rule-based layer has no external dependency), so refused questions are still refused correctly. Patient view and handoff that do not require LLM generation continue working.

## First 5 minutes

1. **Verify the endpoint is down** from inside the cluster:
   ```bash
   kubectl run model-test --image=curlimages/curl --rm -it --restart=Never \
     -- curl -sf -o /dev/null -w "%{http_code}" \
       -H "x-api-key: $ANTHROPIC_API_KEY" \
       https://api.anthropic.com/v1/models
   ```
2. **Check the model client logs** in the narrative and qa pods:
   ```bash
   kubectl logs -n clinical-copilot-prod -l app.kubernetes.io/component=narrative --since=5m
   kubectl logs -n clinical-copilot-prod -l app.kubernetes.io/component=qa --since=5m
   ```
3. **Check for DNS resolution failures** vs TCP connect failures vs HTTP failures — different root causes.
4. **Check the Anthropic status page** (if accessible): https://status.anthropic.com
5. **Check whether the API key is still valid** (key rotation may have been done without updating the secret):
   ```bash
   kubectl get secret clinical-copilot-secrets-prod -n clinical-copilot-prod \
     -o jsonpath='{.data.ANTHROPIC_API_KEY}' | base64 -d | head -c 20
   ```

## Escalation path

1. On-call engineer (immediate)
2. If caused by key rotation without secret update: update the K8s secret and restart pods
3. If the API provider is genuinely down: communicate to clinical users that Q&A and Narrative are temporarily unavailable
4. If down > 4 hours: escalate to engineering lead; consider a fallback response mode

## Related dashboards

- Overview: [Grafana /d/overview](http://grafana.hospital.local/d/overview)
- Q&A Safety (fallback rate): [Grafana /d/qa-safety](http://grafana.hospital.local/d/qa-safety)
