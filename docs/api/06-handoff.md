# 06 — Handoff API

## POST /api/v1/patients/:id/handoff

Generate a factual handoff summary for a single patient.

**Request body:**
```json
{
  "language": "ar" | "en",
  "scope": "current_shift" | "last_24h"  // default "current_shift"
}
```

**Response:**
```json
{
  "id": "uuid",
  "patient_id": "uuid",
  "generated_at": "...",
  "language": "en",
  "text": "PATIENT: Abdullah Al-... / MRN AB-4488721 / Bed IM-3B-12\nADMITTED: 22 May 2026, Day 3 of admission\nADMITTING DIAGNOSIS: Community-acquired pneumonia\n\nDOCUMENTED IN RECORD TODAY (25 May 2026):\n• Morning round documented at 08:30 by Dr. ...\n• Patient reported new-onset dizziness since 24 May afternoon\n...",
  "sections": {
    "identity_and_admission": "...",
    "documented_today": "...",
    "current_medications": "...",
    "recent_vitals": "...",
    "recent_labs": "...",
    "pending_orders": "..."
  },
  "provenance": [ ... ],
  "disclaimer": "Reproduces documented information from the patient record. For clinician reference only. Not a clinical assessment."
}
```

**Important:** Handoff is purely factual. Never contains words like "watch out for", "consider", "may deteriorate", "should monitor for". If pulling from a clinician's progress note, the note text is quoted, not rephrased.

## POST /api/v1/wards/:ward_id/handoff

Bulk handoff for all patients in a ward.

**Request body:**
```json
{
  "language": "en",
  "scope": "current_shift"
}
```

**Response:**
```json
{
  "ward_id": "ward-3b",
  "generated_at": "...",
  "patient_count": 20,
  "patients": [
    {
      "patient_id": "uuid",
      "handoff": { ... same shape as single-patient response }
    },
    ...
  ]
}
```

**Performance budget:** ≤ 60s for 20-patient ward.
