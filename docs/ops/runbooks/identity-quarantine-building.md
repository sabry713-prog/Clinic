# Runbook: Identity Quarantine Building

**Alert**: `IdentityQuarantineBuilding` — `identity_quarantine_open_total` > 50 unresolved records
**Severity**: SEV-3 (MEDIUM)
**Recipient**: Hospital admin + Tech lead

## What this means

The identity reconciler places incoming FHIR records into quarantine when it cannot confidently match them to an existing patient identity (e.g., conflicting MRN, name mismatch, duplicate DOB). A queue depth above 50 means that clinical data for these patients is not appearing in their aggregated views. Clinicians may be missing recent lab results or medications. This is not a safety issue per se (no interpretive content is generated) but it reduces the completeness of the patient view.

## First 5 minutes

1. **Check the quarantine queue depth** and trend:
   ```
   Grafana → Data Ingestion dashboard → Identity quarantine depth panel
   ```
2. **Check the quarantine table** for the oldest unresolved records:
   ```sql
   SELECT id, created_at, source_system, conflict_reason, fhir_resource_type
     FROM ingestion.identity_quarantine
    WHERE resolved_at IS NULL
    ORDER BY created_at ASC
   LIMIT 20;
   ```
3. **Check ingestion logs** for the specific conflict reasons:
   ```bash
   kubectl logs -n clinical-copilot-prod -l app.kubernetes.io/component=core --since=1h \
     | grep '"event":"identity.quarantined"'
   ```
4. **Check if a specific source system** is causing a bulk mismatch (e.g., FHIR feed format change from the hospital):
   ```sql
   SELECT source_system, conflict_reason, count(*)
     FROM ingestion.identity_quarantine
    WHERE resolved_at IS NULL
    GROUP BY 1, 2
    ORDER BY 3 DESC;
   ```
5. **Notify hospital admin** — quarantined records may need manual identity resolution by the hospital's patient registration team.

## Escalation path

1. Tech lead — investigate within 4 business hours
2. Hospital admin — notify within 4 business hours (they may need to fix patient registration data)
3. If queue depth > 200 or growing rapidly: escalate to SEV-2

## Resolution

Quarantined records are resolved by:
- Hospital admin correcting the patient registration data upstream
- Manual review via the admin UI (`/api/v1/admin/quarantine`)
- Automatic resolution on next FHIR sync after the upstream data is corrected

## Related dashboards

- Data Ingestion: [Grafana /d/ingestion](http://grafana.hospital.local/d/ingestion)
