# 11 — Documented Since Last Visit API

## GET /api/v1/patients/:id/since-last-visit

Deterministic list of facts newly documented between the patient's previous encounter and now. Boundary
= the second-most-recent row in `hospital.encounter` for the patient. Read-only, no side effects.

**Status:** Pending CTO + Clinical Advisor sign-off per `docs/architecture/since-last-visit.md` (built
as the boundary-safe reframing of a competitor's AI-flagged "Consider" panel — not yet formally approved
for real-patient use).

**Response (with a previous encounter and new items):**
```json
{
  "has_previous_encounter": true,
  "boundary_at": "2026-06-01T08:00:00.000Z",
  "items": [
    { "type": "condition", "code_display": "Atrial fibrillation", "onset_date": "2026-06-15" },
    { "type": "allergy", "code_display": "Penicillin", "reaction": "Rash", "recorded_at": "2026-06-20" },
    { "type": "medication", "medication_display": "Warfarin", "dose": "5mg", "route": "oral", "frequency": "once daily", "started_at": "2026-06-25T00:00:00.000Z" }
  ]
}
```

**Response (fewer than two encounters on record):**
```json
{ "has_previous_encounter": false, "boundary_at": null, "items": [] }
```

**Important:**
- Every item is a plain fact with its own real timestamp — no interpretation, no risk characterization,
  no severity color-coding, no drug-interaction checking, no recommendations.
- Medication dose changes are **not** paired or diffed ("10mg → 20mg") — the schema has no supersession
  link between medication orders, so each new order appears as its own standalone fact.
- `condition.onset_date` reflects clinical onset, not documentation time — see
  `docs/architecture/since-last-visit.md` for the full per-field semantics table.

**Errors:**
- 403 PATIENT_OUT_OF_SCOPE
