# Runbook: FHIR Ingestion Stalled

**Alert**: `FhirIngestionStalled` — no successful FHIR sync in the last 60 minutes
**Severity**: SEV-2 (HIGH)
**Recipient**: On-call engineer

## What this means

The periodic FHIR ingestion job has not completed a successful sync in over an hour. The patient view data is stale — clinicians may be seeing an outdated record. New lab results, medications, or observations from the hospital's FHIR endpoint are not appearing. This is not a patient-safety issue (we never interpret data) but it degrades the usefulness of the system and may cause clinicians to rely on stale summaries.

## First 5 minutes

1. **Check the ingestion job status** in the logs:
   ```bash
   kubectl logs -n clinical-copilot-prod -l app.kubernetes.io/component=core --since=2h \
     | grep '"event":"ingestion'
   ```
2. **Check FHIR endpoint reachability** from inside the cluster:
   ```bash
   kubectl run fhir-test --image=curlimages/curl --rm -it --restart=Never \
     -- curl -sf "$FHIR_BASE_URL/metadata" | head -20
   ```
3. **Check the last successful sync timestamp**:
   ```sql
   SELECT MAX(ts) AS last_success
     FROM audit.event
    WHERE action = 'INGESTION_SYNC_COMPLETED';
   ```
4. **Check for FHIR rate limiting** — look for 429 responses in the ingestion logs.
5. **Check the ingestion feature flag** — is `FEATURE_FLAG_INGESTION_ENABLED` set to `false`?:
   ```bash
   kubectl get cm clinical-copilot-config -n clinical-copilot-prod -o yaml \
     | grep INGESTION
   ```

## Escalation path

1. On-call engineer (immediate — FHIR endpoint outage is a hospital-side issue)
2. If FHIR endpoint is unreachable: notify hospital IT within 15 minutes
3. If stalled > 4 hours: escalate to engineering lead
4. Communicate to clinical users that data may be up to N hours old

## Resolution

Once the FHIR endpoint is reachable, the ingestion scheduler will resume automatically on its next tick. To trigger an immediate re-sync:
```bash
curl -X POST http://core/api/v1/admin/ingestion/trigger \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Related dashboards

- Data Ingestion: [Grafana /d/ingestion](http://grafana.hospital.local/d/ingestion)
