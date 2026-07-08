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

## ICD-10-AM coding (suggest → confirm)

CTO sign-off recorded 2026-07-08 for the suggest→confirm coding pattern.

Suggestions are deterministic lookups against the `app.snomed_icd10am_map`
reference table (licensed mapping tables in production; dev rows seeded by
migration `1718800000000`). Nothing persists at suggest time — only an
explicit clinician confirmation writes to `app.condition_icd_coding`, and
the confirmed code must equal the reference-map suggestion (free-text codes
are rejected). All three endpoints are audit-logged.

- `GET /api/v1/patients/:id/nphies/coding` (`patient:read`) — active
  conditions with confirmed code (if any) and reference-map suggestion.
  Audit: `NPHIES_CODING_VIEW`.
- `POST /api/v1/patients/:id/nphies/coding/:conditionId/confirm`
  (`condition:write`) — clinician confirms the suggested code.
  Audit: `NPHIES_CODING_CONFIRM`.
- `DELETE /api/v1/patients/:id/nphies/coding/:conditionId`
  (`condition:write`) — clinician removes a confirmation (correction).
  Audit: `NPHIES_CODING_UNCONFIRM`.

The `icd10am_mapping` readiness check passes once every active condition
has a clinician-confirmed ICD-10-AM code.

## SBS order coding (suggest → confirm)

Same pattern as ICD-10-AM, applied to active service requests. Suggestions
come from `app.order_sbs_map` (dev rows in SBS format seeded by migration
`1718900000000` — production loads the licensed SBS catalog); confirmations
persist to `app.service_request_sbs_coding`.

- `GET /api/v1/patients/:id/nphies/order-coding` (`patient:read`) —
  audit: `NPHIES_ORDER_CODING_VIEW`.
- `POST /api/v1/patients/:id/nphies/order-coding/:orderId/confirm`
  (`service_request:write`) — audit: `NPHIES_ORDER_CODING_CONFIRM`.
- `DELETE /api/v1/patients/:id/nphies/order-coding/:orderId`
  (`service_request:write`) — audit: `NPHIES_ORDER_CODING_UNCONFIRM`.

The `sbs_coding_confirmed` readiness check passes once every active order
has a clinician-confirmed SBS code.

## Diagnosis linkage (clinician-captured)

NPHIES claims require each item to reference a supporting diagnosis.
Unlike the vocabulary mappings above, the system offers **no suggestions**
here — deciding which diagnosis supports which order is clinical
reasoning (CLAUDE.md §2). The clinician picks from their own documented
active conditions; the system records the choice in
`app.service_request_diagnosis_link` (migration `1719000000000`).

- `GET /api/v1/patients/:id/nphies/linkage` (`patient:read`) —
  audit: `NPHIES_LINKAGE_VIEW`.
- `POST /api/v1/patients/:id/nphies/linkage/:orderId/:conditionId`
  (`service_request:write`) — audit: `NPHIES_LINKAGE_LINK`.
- `DELETE /api/v1/patients/:id/nphies/linkage/:orderId/:conditionId`
  (`service_request:write`) — audit: `NPHIES_LINKAGE_UNLINK`.

The `order_diagnosis_linkage` readiness check passes once every active
order has at least one clinician-captured diagnosis link.

## Connector: eligibility, claim assembly, submission

Provider pattern mirrors the model providers: `NPHIES_CONNECTOR=stub`
(default) returns canned payer responses so the full workflow runs
without CCHI onboarding; `live` requires NPHIES credentials +
certificates (not yet implemented — selecting it errors honestly).
Every persisted row records its `mode` so stub data can never be
mistaken for a real payer response.

Claim assembly is a deterministic aggregation of clinician-confirmed
artifacts only — confirmed ICD-10-AM codes, confirmed SBS codes,
clinician-captured diagnosis links. Anything unconfirmed is a blocker,
never a guess.

- `GET /api/v1/patients/:id/nphies/claim-draft` (`patient:read`) — FHIR
  Claim draft + blockers. Audit: `NPHIES_CLAIM_DRAFT_VIEW`.
- `POST /api/v1/patients/:id/nphies/eligibility` (`service_request:write`)
  — persists to `app.nphies_eligibility_check`. Audit: `NPHIES_ELIGIBILITY_CHECK`.
- `POST /api/v1/patients/:id/nphies/claims` (`service_request:write`) —
  rejects with blocker list unless the draft is ready; persists bundle +
  payer response to `app.nphies_claim`. Audit: `NPHIES_CLAIM_SUBMIT`.
- `GET /api/v1/patients/:id/nphies/claims` (`patient:read`) — recent
  claims with status/rejection codes. Audit: `NPHIES_CLAIMS_VIEW`.

The `eligibility_checked` readiness check passes when an `eligible`
result exists within 7 days (the detail names the connector mode).

Tables: migration `1719100000000`. Env: `NPHIES_CONNECTOR=stub|live`.

## Roadmap (not yet implemented)

1. **Live NPHIES connector**: CCHI onboarding, sandbox credentials, certificates; real eligibility/claim/rejection exchange.
2. **Rejection analytics**: factual dashboard of rejection codes over time (schema already captures `rejection_codes` per claim).
