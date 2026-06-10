# Runbook: Audit Chain Integrity Violation

**Alert**: `AuditChainIntegrityViolation` — `audit_chain_integrity_violation_total` > 0
**Severity**: SEV-1 (CRITICAL)
**Recipient**: CTO + On-call engineer + Security lead (all immediately)

## What this means

The audit log hash chain has been broken. Every row in `audit.event` contains a SHA-256 hash of its own content plus the hash of the previous row. A violation means one or more rows have been modified, deleted, or inserted out of order after the fact — or the hash algorithm was applied incorrectly. Any non-zero count is a potential evidence of tampering with the audit trail. This is the most operationally critical alert in the system and is classified as SEV-1 without exception.

**Do not dismiss or defer this alert.** The audit log is regulatory evidence under PDPL and SFDA. Tampering with it is a legal matter.

## First 5 minutes

1. **Page CTO and security lead immediately** — do not wait for investigation results.

2. **Freeze audit log writes** — put the application into read-only mode to prevent further writes until the extent of the violation is understood:
   ```bash
   kubectl set env deployment/clinical-copilot-core \
     AUDIT_WRITE_ENABLED=false \
     -n clinical-copilot-prod
   ```

3. **Identify the violated range** — run the hash verification query:
   ```sql
   SELECT id, ts, action, prev_hash, hash,
          encode(
            sha256(
              (ts::text || tenant_id || user_id || action ||
               coalesce(resource_type,'') || coalesce(resource_id,'') ||
               coalesce(patient_id::text,'') || coalesce(details::text,'') ||
               coalesce(prev_hash,''))::bytea
            ), 'hex'
          ) AS recomputed_hash,
          hash != encode(sha256(...), 'hex') AS violated
     FROM audit.event
    ORDER BY ts ASC, id ASC;
   ```
   (Use the `audit-verify` CLI or `AuditVerifyService.verifyChain()` for a pre-built version.)

4. **Take an immutable snapshot** of the affected rows immediately (before anyone else touches the database):
   ```sql
   COPY (
     SELECT * FROM audit.event
      WHERE ts >= '<violation_start>' AND ts <= '<violation_end>'
      ORDER BY ts ASC, id ASC
   ) TO '/tmp/audit-snapshot-YYYYMMDD.csv' CSV HEADER;
   ```

5. **Cross-check with WORM replica** — download the corresponding NDJSON export from S3 and compare:
   ```bash
   aws s3 cp s3://clinical-copilot-audit/audit/YYYY/MM/DD/audit-YYYY-MM-DD.ndjson.gz /tmp/
   gunzip /tmp/audit-YYYY-MM-DD.ndjson.gz
   # Compare rows in the violation range
   ```

## Escalation path

1. CTO — page immediately (SMS + phone)
2. Security lead — page immediately
3. Hospital admin and DPO — written notification within 1 hour
4. Regulatory consultant — notification within 4 hours
5. If WORM replica is clean and live table is not: **hospital security incident process** — the live table was externally tampered with

## Resolution criteria

Do NOT resume normal write mode until:
- Root cause is identified and documented
- WORM replica and live table are reconciled
- CTO has given written sign-off

## Related dashboards

- Security: [Grafana /d/security](http://grafana.hospital.local/d/security)
- Audit events: [Grafana /d/security?var-panel=audit_chain](http://grafana.hospital.local/d/security)

## Reference

See the full SEV-1 audit integrity protocol in `docs/ops/03-incident-response.md`.
