# Runbook: Q&A Blocklist Surge

**Alert**: `QaBlocklistSurge` — `qa_blocklist_triggered_total` > 5 per minute
**Severity**: SEV-2 (HIGH)
**Recipient**: On-call engineer + Clinical Advisor

## What this means

The blocklist post-processor is firing more than 5 times per minute. This means the LLM model is generating answers that contain interpretive language at an elevated rate, and the blocklist filter is catching them before they reach users. This is the safety system working — but a surge indicates either a model behavior change (prompt drift, model version change, jailbreak attempt) or a blocklist gap causing excessive false positives. Both require immediate investigation.

**This is a regulatory evidence event.** Every blocked response is logged. If the surge is caused by the model consistently leaking interpretive content, it may indicate a SEV-1 boundary violation risk.

## First 5 minutes

1. **Check the blocklist triggered rate** over the last 30 minutes:
   ```
   Grafana → Q&A Safety dashboard → Blocklist triggers panel
   ```
2. **Check the refusal category distribution** — is there a new category appearing?
   ```
   Grafana → Q&A Safety dashboard → Classification distribution
   ```
3. **Inspect recent audit events** for blocklist-triggered rows:
   ```sql
   SELECT action, details, ts
     FROM audit.event
    WHERE action = 'QA_BLOCKLIST_TRIGGERED'
    ORDER BY ts DESC
    LIMIT 20;
   ```
4. **Check if a model version or prompt template changed** in the last deploy.
5. **Check classifier confidence** — low confidence increases model layer invocations, which increases blocklist exposure:
   ```
   Grafana → Q&A Safety dashboard → Classifier confidence histogram
   ```

## Escalation path

1. On-call engineer (immediate — check within 5 minutes)
2. Clinical Advisor — notified by page within 15 minutes
3. If any blocked content was returned to users (audit shows `QA_BLOCKLIST_BYPASS`): escalate to SEV-1 immediately per `docs/ops/03-incident-response.md`
4. CTO notification if SEV-1 escalation triggered

## Kill switch

If in doubt, set `qa.allow_responses=false` to put Q&A in refusal-only mode:
```bash
kubectl set env deployment/clinical-copilot-core \
  FEATURE_FLAG_QA_ALLOW_RESPONSES=false \
  -n clinical-copilot-prod
```

## Related dashboards

- Q&A Safety: [Grafana /d/qa-safety](http://grafana.hospital.local/d/qa-safety)
- Narrative Safety: [Grafana /d/narrative-safety](http://grafana.hospital.local/d/narrative-safety)
