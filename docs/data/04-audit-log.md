# 04 — Audit Log

## Goals

1. Tamper-evident record of every access and action
2. Compliance evidence for PDPL, NCA ECC, hospital governance
3. Operational forensics for incidents
4. Regulatory readiness for SFDA post-market monitoring (Phase 2)

## Event types

| Action | When |
|---|---|
| `LOGIN_SUCCESS` | OIDC validation succeeded |
| `LOGIN_FAILURE` | OIDC validation failed |
| `LOGIN_LOCKOUT` | Account locked after threshold |
| `LOGOUT` | User logged out |
| `SESSION_TIMEOUT` | Session expired |
| `PATIENT_VIEW` | Aggregated patient view fetched |
| `PATIENT_OBSERVATIONS_VIEW` | Observations endpoint fetched |
| `PATIENT_MEDICATIONS_VIEW` | Medications endpoint fetched |
| `PATIENT_DOCUMENT_VIEW` | Document fetched |
| `NARRATIVE_REQUEST` | Narrative requested |
| `NARRATIVE_GENERATED` | Narrative successfully generated |
| `NARRATIVE_FALLBACK` | Narrative blocklist failure |
| `QA_REQUEST` | Q&A question submitted |
| `QA_ANSWERED` | Q&A factual answer returned |
| `QA_REFUSED` | Q&A interpretive query refused |
| `QA_FALLBACK` | Q&A blocklist failure |
| `HANDOFF_GENERATED` | Handoff generated |
| `ROLE_CHANGED` | User role modified by admin |
| `SCOPE_RECOMPUTED` | Patient scope refreshed |
| `BREAK_GLASS_ACCESS` | Out-of-scope patient access requested |
| `CONFIG_CHANGED` | Hospital configuration updated |
| `IDENTITY_QUARANTINED` | Identity reconciliation quarantine created |
| `IDENTITY_RESOLVED` | Quarantine resolved |
| `DSR_RECEIVED` | Data subject request received |
| `DSR_FULFILLED` | Data subject request fulfilled |
| `SYNC_COMPLETED` | FHIR ingestion sync completed |
| `SYNC_ERROR` | FHIR ingestion error |
| `BLOCKLIST_TRIGGERED` | Generative output triggered blocklist |
| `CLASSIFIER_LOW_CONFIDENCE` | Classifier low confidence (review flag) |

## Metadata payload conventions

`metadata_json` carries action-specific context. Examples:

**QA_ANSWERED:**
```json
{
  "question_text": "...",
  "question_language": "en",
  "classifier_confidence": 0.97,
  "source_count": 5,
  "model_version": "...",
  "prompt_template_version": "v1.0",
  "latency_ms": 2150,
  "blocklist_retries": 0
}
```

**QA_REFUSED:**
```json
{
  "question_text": "...",
  "refusal_category": "TREND_INTERPRETATION",
  "rule_matches": ["TREND_INTERPRETATION:is_X_getting_worse"],
  "classifier_confidence": 0.99
}
```

**PATIENT_VIEW:**
```json
{
  "request_path": "/api/v1/patients/:id",
  "user_agent_hash": "..."
}
```

**BREAK_GLASS_ACCESS:**
```json
{
  "reason": "user-provided text",
  "duration_minutes": 240,
  "notified_admin_ids": ["uuid"]
}
```

**No PHI in metadata.** Question text in Q&A logs is acceptable because clinicians control it and it's part of the audit obligation; however, free-text fields that could contain PHI from external sources are not stored.

## Hash chain

Each row's `hash_self` is computed as:
```
hash_self = SHA-256(
  canonical_bytes_of(this_row, excluding hash_self field)
)
```

Where `canonical_bytes_of` produces a deterministic byte representation: sorted keys, no whitespace, ISO timestamps. Include `hash_prev` in the bytes.

`hash_prev` is the `hash_self` of the immediately preceding row by `ts ASC, id ASC`. For the first row, `hash_prev` is the all-zero hash.

## Integrity verification

A scheduled job replays the hash chain and reports any mismatches.

```
SELECT id, ts FROM audit.event ORDER BY ts ASC, id ASC;
For each row:
  expected_prev = previous_row.hash_self
  compute hash_self_check from this_row
  if hash_self != hash_self_check: VIOLATION
  if hash_prev != expected_prev: VIOLATION
```

Schedule: hourly during MVP development, daily in production.

## WORM replica

Daily export to in-Kingdom object storage with object-level immutability (`Object Lock` in S3-compatible bucket with retention period set).

Format: NDJSON, one event per line, sorted by `ts ASC, id ASC`.

File naming: `audit/{YYYY}/{MM}/{DD}/audit-{YYYY-MM-DD}.ndjson.gz`.

## Retention

- PostgreSQL audit.event table: 2 years online, queryable
- Object storage WORM replica: 7 years
- Cold storage (after 2 years): infrequent access tier with WORM

## Access controls

- Audit endpoints accessible to `hospital_admin` role only
- All audit endpoint access itself audit logged (recursive — audit log access is audited)
- Direct database access to `audit` schema restricted to specific service accounts; sysadmin access requires break-glass procedure
