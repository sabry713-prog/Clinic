# 04 — Narrative API

## POST /api/v1/patients/:id/narrative

Generate a factual narrative summary of the patient's record.

**Request body:**
```json
{
  "language": "ar" | "en",  // optional, defaults to user's preferred_language
  "scope": "full" | "current_encounter" | "last_30_days",  // optional, default "full"
  "regenerate": true | false  // optional, force regeneration (default false: return cached if < 5 min old)
}
```

**Response:**
```json
{
  "id": "uuid",
  "patient_id": "uuid",
  "generated_at": "2026-05-25T08:04:00+03:00",
  "language": "en",
  "scope": "full",
  "text": "Mr. Abdullah Al-... is a 68-year-old man currently admitted ...",
  "provenance": [
    {
      "sentence_index": 0,
      "char_range": [0, 84],
      "sources": [
        { "type": "Patient", "id": "uuid", "field": "demographics" },
        { "type": "Encounter", "id": "uuid", "field": "admission" }
      ]
    },
    ...
  ],
  "model_version": "...",
  "prompt_template_version": "v1.0",
  "disclaimer": "Auto-generated descriptive summary. Not a clinical interpretation. For clinician review only."
}
```

**Important:**
- Output text contains **only descriptive facts**. No interpretive language.
- Every sentence has at least one provenance entry.
- If generation fails the blocklist filter twice, return:

```json
{
  "id": "uuid",
  "patient_id": "uuid",
  "generated_at": "...",
  "language": "en",
  "scope": "full",
  "text": null,
  "fallback_message": "Narrative summary unavailable. Please review the record directly.",
  "disclaimer": "..."
}
```

**Performance budget:** ≤ 8s P95.

**Errors:**
- 403 PATIENT_OUT_OF_SCOPE
- 503 NARRATIVE_SERVICE_UNAVAILABLE

## GET /api/v1/patients/:id/narrative/:narrative_id

Retrieve a previously generated narrative.

## GET /api/v1/patients/:id/narrative/:narrative_id/sources

Retrieve full source records referenced by the narrative (for the "hover to see source" UX).

## POST /api/v1/patients/:id/narrative/:narrative_id/patient-recap

Restyle an already-generated narrative into plain-language prose for the patient to read. Reuses the
stored narrative text as its only source of facts — no new patient data is read, and no new facts are
introduced. Not persisted or cached; regenerated fresh on each request.

**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off per
`docs/prompts/patient-recap-prompt.md` (built per competitive-assessment "safe to add" item; not yet
formally approved for real-patient use).

**Request body:** none.

**Response:**
```json
{
  "text": "Your record shows documented hypertension. Creatinine: 168 umol/L [59-104 umol/L].",
  "fallback_message": null,
  "prompt_template_version": "v1.0",
  "blocklist_triggered": false,
  "disclaimer": "Plain-language restyling of the clinical summary above -- same documented facts, friendlier wording. Not a clinical interpretation."
}
```

**Important:**
- Restyle-only: reproduces only facts already present in the source narrative. No facts added, omitted, or reinterpreted.
- Clinical terms (drug names, lab codes, diagnoses) are preserved verbatim — no lay-synonym substitution, per CLAUDE.md §8.
- Same blocklist gate as narrative generation, with the same retry-then-fallback pattern (2 retries, then `text: null` with `fallback_message`).
- If the source narrative has no text (`fallback_message` was returned instead), this endpoint returns 404.

**Errors:**
- 403 PATIENT_OUT_OF_SCOPE
- 404 NARRATIVE_NOT_FOUND
- 503 NARRATIVE_SERVICE_UNAVAILABLE
