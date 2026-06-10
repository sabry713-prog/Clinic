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
