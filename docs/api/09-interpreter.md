# 09 — Medical Interpreter API

## POST /api/v1/patients/:id/interpreter/translate

Translate a short clinician<->patient communication message between languages. Does **not** read
the patient record — the caller supplies the message text directly. Not persisted or cached;
translated fresh on each request.

**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off per
`docs/prompts/interpreter-prompt.md` (built per competitive-assessment "safe to add" item; not yet
formally approved for real-patient use).

**Request body:**
```json
{
  "text": "Please take Panadol twice daily.",
  "source_language": "en",
  "target_language": "ar"
}
```

`text` is limited to 2000 characters. `source_language` / `target_language` are free-text language
codes (limited to 20 characters); the web UI currently offers English, Arabic, Urdu, Tagalog, and
Hindi.

**Response:**
```json
{
  "text": "من فضلك خذ Panadol مرتين يومياً.",
  "fallback_message": null,
  "prompt_template_version": "v1.0",
  "blocklist_triggered": false,
  "disclaimer": "Machine translation for bedside communication. Not a clinical interpretation. For urgent or complex conversations, use a qualified human interpreter."
}
```

**Important:**
- Translation only: no facts added, omitted, or reinterpreted from the source message.
- Clinical terms (drug names, lab test names, diagnosis names, numeric values + units) are preserved
  verbatim in the translated output — never substituted, per CLAUDE.md §8.
- Same blocklist gate as narrative generation, with the same retry-then-fallback pattern (2 retries,
  then `text: null` with `fallback_message` suggesting an in-person interpreter).
- The blocklist scanner only has compiled pattern sets for `en`/`ar`; other target languages fall
  back to the English pattern set (existing `packages/blocklist` behavior).

**Errors:**
- 403 PATIENT_OUT_OF_SCOPE
- 503 NARRATIVE_SERVICE_UNAVAILABLE
