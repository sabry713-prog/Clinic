# Ambient Structured-Transcription Capture

**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off — see
`docs/prompts/ambient-segmentation-prompt.md` for the full safety rationale and change-control gate.

Records the clinician<->patient conversation during an encounter, transcribes it on-prem, and lets the
clinician have it classified into note sections (Chief Complaint, History, Assessment, Plan) before
creating a normal, editable, sign-required document draft. This revises the "no ambient/always-on
capture" boundary that `docs/architecture/dictation.md` had previously fenced off as a deferred,
separately-scoped effort ("Project 2") — that deferral is what this document resolves.

## Scope

**In scope:**
- Explicit Start / explicit Stop recording, with a visible recording indicator and duration.
- An explicit consent acknowledgment the clinician must check before recording can start.
- On-prem transcription (reuses the existing dictation `/transcribe` pipeline unchanged).
- Verbatim-only section classification (see `docs/prompts/ambient-segmentation-prompt.md`).
- Creating a normal `encounter_note` document draft from the confirmed sections, which then follows
  the exact same edit/sign/export lifecycle as every other document type.

**Explicitly out of scope for this slice:**
- Speaker diarization (doctor vs. patient voice separation) — the conversation transcribes as one
  stream.
- Always-on or background recording of any kind.
- Any AI-authored clinical content, diagnosis, coding, or recommendation — segmentation only relocates
  words the speaker already said.

## Flow

```
Clinician acknowledges consent ──▶ ● Start recording ──▶ ■ Stop recording
   ──▶ POST /api/v1/patients/:id/transcribe   (unchanged dictation pipeline, on-prem STT)
   ──▶ raw transcript shown to clinician for review
   ──▶ POST /api/v1/patients/:id/ambient/segment
   ──▶ transcription service /segment: verbatim-verified section classification
       (2 retries; on failure the ENTIRE original transcript is preserved as "unclassified" --
        nothing invented, nothing dropped)
   ──▶ editable section previews shown to clinician
   ──▶ POST /api/v1/patients/:id/drafts  { document_type: "encounter_note", prefill_sections, transcript }
   ──▶ DraftService.generate() re-validates EVERY prefill section against the transcript
       (isClinicianAuthoredOnly -- same check, independent of the segmentation service)
   ──▶ normal, editable, unsigned draft opens in the existing DraftPanel edit/sign/export flow
```

## Components

- **`apps/transcription/src/transcription/segment.py`** — `segment_transcript()`, the verbatim-gated
  classification loop; `apps/transcription/src/transcription/verbatim.py` — the substring-check port of
  `isClinicianAuthoredOnly`.
- **`apps/transcription/main.py`** — `POST /segment`.
- **`apps/core/src/ambient/`** — `AmbientController`/`AmbientService`, proxies segmentation, audited as
  `AMBIENT_TRANSCRIPT_SEGMENTED` (no transcript text logged).
- **`apps/core/src/draft/draft.service.ts`** — `"encounter_note"` document type (Chief Complaint,
  History, Assessment, Plan, all clinician-authored-only); `generate()`'s `prefill` parameter, which
  re-validates every ambient-sourced section independently of the transcription service.
- **`apps/web/src/components/AmbientPanel/AmbientPanel.tsx`** — recording UI, consent gate, raw
  transcript review, editable section previews, "Create draft."

## PHI handling

Same posture as dictation (`docs/architecture/dictation.md`): audio is held in-memory only for the
duration of the request and discarded after transcription — never stored or logged. Transcript content
is never logged; audit events (`AMBIENT_TRANSCRIPT_SEGMENTED`, `DRAFT_GENERATED`) record metadata only
(section keys, retry counts, character-adjacent flags) — never the transcript or section text itself.
All processing is on-prem (CLAUDE.md §7).

## Config

`transcription_segmentation` (`apps/transcription/src/transcription/config.py`): `"stub"` (default —
everything returned as a single unclassified block, safe for dev/CI without a model) or `"llm"`
(on-prem classification, reusing the same `model_endpoint_url`/`model_name`/`model_api_key` settings
already used by `transcription_reformat`). Same flip-a-switch pattern as every other model-gated
feature in this codebase.
