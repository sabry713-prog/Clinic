# 08 — NPHIES endpoints

Endpoints supporting NPHIES (the Saudi national health-insurance exchange)
claim workflows. Everything in this module is **administrative**: claim
completeness, coding presence, connector status. Nothing here interprets
clinical data or advises on care — see `CLAUDE.md` §2. Status colors and
pass/fail verdicts refer to billing paperwork, never to the patient.

## GET /api/v1/patients/:id/nphies/claim-readiness

Deterministic clean-claim checks for one patient. Rules-only (no model
call); every check is a completeness/consistency query over data the
clinician already documented.

Permission: `patient:read` + patient scope. Access is audit-logged as
`NPHIES_CLAIM_READINESS_VIEW`.

### Checks

| id | Meaning | Failure mode |
|---|---|---|
| `identity_complete` | MRN, DOB, sex, national ID present | fail |
| `encounter_present` | ≥1 encounter to attach the claim to | fail |
| `diagnosis_documented` | ≥1 active documented condition | fail |
| `diagnosis_coded` | active conditions carry codes | warning |
| `icd10am_mapping` | SNOMED→ICD-10-AM mapping configured | warning (until mapping ships) |
| `orders_present` / `orders_coded` | active service requests exist / carry codes (SBS) | warning |
| `order_diagnosis_linkage` | claim items reference a diagnosis | warning (linkage capture not yet built) |
| `medications_coded` | active medications carry codes | warning |
| `eligibility_checked` | NPHIES eligibility verified | warning (connector not configured) |

### Response

```json
{
  "patient_id": "…",
  "generated_at": "2026-07-07T…Z",
  "overall": "ready | issues | blocked",
  "checks": [
    { "id": "identity_complete", "label": "Patient identity fields", "status": "pass", "detail": "…" }
  ],
  "disclaimer": "Administrative claim-completeness checks only. Not a clinical assessment and not billing advice."
}
```

`overall` is `blocked` if any check fails, `issues` if any check warns,
otherwise `ready`.

## Roadmap (not yet implemented)

1. **SNOMED → ICD-10-AM mapping** for documented conditions (suggest → coder/doctor confirms; same pattern as the problem-list write, requires the regulatory sign-off flagged in the competitive assessment).
2. **SBS code mapping** for service requests (same confirm pattern).
3. **Diagnosis-linkage capture** at claim assembly.
4. **NPHIES FHIR connector**: eligibility check, claim submission, rejection-reason ingestion.
5. **Rejection analytics**: factual dashboard of rejection codes over time.
