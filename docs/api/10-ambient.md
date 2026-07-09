# 10 — Ambient Structured-Transcription Capture API

**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off per
`docs/prompts/ambient-segmentation-prompt.md` (structured extraction was explicitly chosen over
raw-capture-only after a scoping discussion on 2026-07-09; see that doc and
`docs/architecture/ambient-capture.md` for the full safety design — not yet formally approved for
real-patient use).

## POST /api/v1/patients/:id/ambient/segment

Classify an already-transcribed encounter recording into note sections. Does **not** read the patient
record — the caller supplies the transcript text directly (from `POST
/api/v1/patients/:id/transcribe`, unchanged). Not persisted; every section returned is a **verified
verbatim substring** of the transcript, or the request falls back to returning the entire original
transcript as `unclassified_text` — never a fabricated or partially-trusted result.

**Request body:**
```json
{
  "text": "Patient reports a cough for three days. I think this is bronchitis. Start amoxicillin.",
  "sections": [
    { "key": "chief_complaint", "title": "Chief Complaint" },
    { "key": "history", "title": "History" },
    { "key": "assessment", "title": "Assessment" },
    { "key": "plan", "title": "Plan" }
  ],
  "language": "en"
}
```

`text` is limited to 20,000 characters; `sections` to 10 entries.

**Response:**
```json
{
  "sections": [
    { "key": "chief_complaint", "text": "Patient reports a cough for three days." },
    { "key": "assessment", "text": "I think this is bronchitis." },
    { "key": "plan", "text": "Start amoxicillin." }
  ],
  "unclassified_text": "",
  "retries": 0
}
```

**Important:**
- Classification only: every returned section value is copied verbatim from `text`, never paraphrased,
  summarized, or added to.
- If the model's response ever fails verbatim verification (any attempt, any section), the whole
  attempt is discarded and retried (2 retries); after that, `sections` is empty and
  `unclassified_text` contains the **entire original transcript**, untouched — no content is ever
  silently dropped or fabricated.
- No blocklist scan is applied here — clinician/patient speech, like every other clinician-authored
  section in `draft.service.ts`, is trusted content once verified verbatim (the boundary is authorship,
  not vocabulary).

**Errors:**
- 403 PATIENT_OUT_OF_SCOPE
- 503 TRANSCRIPTION_SERVICE_UNAVAILABLE

## Creating a draft from segmented sections

`POST /api/v1/patients/:id/drafts` (see the existing drafts endpoints) accepts two additional optional
fields when `document_type` is `"encounter_note"`:

```json
{
  "document_type": "encounter_note",
  "language": "en",
  "specialty": "general",
  "transcript": "Patient reports a cough for three days. I think this is bronchitis. Start amoxicillin.",
  "prefill_sections": [
    { "key": "chief_complaint", "text": "Patient reports a cough for three days." },
    { "key": "assessment", "text": "I think this is bronchitis." },
    { "key": "plan", "text": "Start amoxicillin." }
  ]
}
```

Every `prefill_sections` entry is **independently re-validated** against `transcript` by
`DraftService.generate()` — the core service does not trust whatever the `/ambient/segment` endpoint
returned; a section that fails verification (e.g. the clinician edited it to add new content in the
preview UI) returns `400` with `"Section '{key}' prefill is not a verbatim substring of the source
transcript"`. Sections without a matching prefill key fall back to the normal dictate-fresh placeholder,
same as manually starting an `encounter_note` draft. The resulting draft follows the unchanged E6
edit/sign/export lifecycle — see the drafts endpoints in the existing API documentation.
