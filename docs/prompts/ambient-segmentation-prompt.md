# Ambient Transcript Segmentation Prompt Template

**Version:** v1.0
**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off (built per
competitive-assessment "safe to add" backlog, scoped via explicit user decision on 2026-07-09 to
include structured extraction rather than raw-capture-only — see change control below). Not yet
formally approved for real-patient use.
**Change control:** Modifications require CTO + Clinical Advisor + Regulatory Consultant approval
(CLAUDE.md §6 item 1 — new prompt template; item 4 — new feature not enumerated in §1).

## Overview

Classifies an already-transcribed clinician<->patient encounter conversation into note sections
(Chief Complaint, History, Assessment, Plan) **without paraphrasing, summarizing, correcting, or
adding a single word**. The model's only job is to say which section an existing span of already-
spoken text belongs to.

This revises a previously-approved scope boundary: `docs/architecture/dictation.md` originally stated
*"the tool does not record the patient and has no ambient/always-on capture... explicitly out of scope
(Project 2)"*. That boundary anticipated exactly this feature and deliberately fenced it off pending
its own scoping. This document, together with `docs/architecture/ambient-capture.md`, is that scoping.
Always-on/background capture and AI-authored clinical content both remain explicitly out of scope —
see "What this does not do" below.

## Why this stays inside the non-SaMD Health IT boundary

The real safety mechanism is **not** the prompt — it is a server-side verbatim-substring check applied
to every classified span before it is trusted, ported directly from the same invariant already used
for Assessment/Plan sections in document drafting:

- `apps/core/src/draft/draft.service.ts` `isClinicianAuthoredOnly(text, authoredSource)` — a
  clinician-authored-only section's text must be either the empty sentinel or a
  whitespace/case-insensitive **verbatim substring** of the clinician's own words. The blocklist scan
  is explicitly skipped for these sections (comment: *"CAO is clinician's own words"*) because
  clinician-authored content is trusted content — **the boundary is authorship, not vocabulary.**
- `apps/transcription/src/transcription/verbatim.py` `is_verbatim_substring()` is a direct Python port
  of the same check, applied in `segment.py` to every section the model returns. **A response is
  accepted only if every single section value is a verified substring of the source transcript.** If
  any value fails, the *entire* attempt is discarded (never partially trusted) and retried; after
  `MAX_RETRIES` (2), the **entire original transcript** is preserved verbatim under "unclassified" —
  content is never silently dropped, and fabricated content is never admitted.

Because the model can only ever *relocate* text the doctor (or patient, via the doctor's own
recording) already said, it cannot originate a diagnosis, finding, or recommendation. If the doctor's
own words already contain a diagnostic statement — e.g. "I think this is bronchitis" — filing that
statement under "Assessment" is not the system diagnosing; it is the system doing exactly what a
transcriptionist or scribe does, which is administrative/organizational, not clinical judgment. This
is the same authorship principle CLAUDE.md's "doctor-authored-content-with-AI-code-lookup
(suggest→confirm pattern)" already permits, extended from typed/dictated content to recorded content.

## What this does not do

- No speaker diarization (doctor vs. patient voice separation) — the whole conversation is
  transcribed as one stream, same as `apps/transcription` does for dictation today.
- No diagnosis, coding, recommendation, or any other clinical content generation — the segmenter only
  relocates verbatim spoken text; it never writes a new word.
- No always-on/background recording — explicit Start, explicit Stop only, plus a consent
  acknowledgment the clinician must check before recording begins (`AmbientPanel.tsx`).
- Nothing is written to the patient record until the clinician explicitly clicks "Create draft," and
  nothing is final until they sign the resulting draft — identical guarantees to every other document
  type in `draft.service.ts`.

## System prompt

```
You classify a clinical encounter transcript into note sections. You do NOT write, paraphrase, summarize, correct, or add any content.

ABSOLUTE RULES:
1. Every span of text you place into a section MUST be copied VERBATIM (exact words, exact order) from the transcript. Do not paraphrase, summarize, reword, translate, or correct anything.
2. Do NOT add any word, sentence, finding, diagnosis, or instruction that is not already in the transcript.
3. Classify each part of the transcript into exactly one of the given section keys, based on what the speaker is doing (describing why they came in, describing history, stating an assessment/impression, stating a plan). If a part of the transcript does not clearly belong to any given section, place it under "unclassified" instead of forcing it into the wrong section or dropping it.
4. COMPLETENESS: every part of the transcript must appear in your output, in exactly one section (including "unclassified"). Do not omit anything.
5. Output ONLY a single JSON object mapping each given section key (plus "unclassified") to its assigned verbatim text (use an empty string for a key with nothing assigned). No commentary, no markdown code fences, no text outside the JSON object.
```

## Pipeline

```
[Explicit Start recording, consent acknowledged] → [Explicit Stop]
        ↓
[On-prem STT — apps/transcription/main.py POST /transcribe, unchanged from dictation]
        ↓
[Clinician reviews the raw transcript in the UI before proceeding]
        ↓
[Segmentation — POST /segment, retry up to 2x on any verbatim violation]
        ↓
[Server-side verbatim-substring check on EVERY section, every attempt]
        ↓
[Section previews, clinician-editable — POST /api/v1/patients/:id/drafts with
 prefill_sections, re-validated AGAIN by isClinicianAuthoredOnly in core]
        ↓
[Normal encounter_note draft: edit / sign / export — unchanged E6 lifecycle]
```

Note the **double validation**: once in the Python segmentation service, and again in
`draft.service.ts` when the draft is actually created (the core service does not trust the
transcription service's word for it — every prefill section is re-checked against the transcript the
caller supplies).

## Endpoints

- `POST /segment` (`apps/transcription/main.py`) — `{text, sections: [{key, title}], language}` →
  `{sections: [{key, text}], unclassified_text, retries}`.
- `POST /api/v1/patients/:id/ambient/segment` (`apps/core/src/ambient/`) — core proxy, audited as
  `AMBIENT_TRANSCRIPT_SEGMENTED` (no transcript text in audit metadata).
- `POST /api/v1/patients/:id/drafts` with `document_type: "encounter_note"` and `prefill_sections` —
  see `docs/api/10-ambient.md` and `docs/api/` draft documentation for the full request/response shape.

## Known limitation

`transcription_segmentation` defaults to `"stub"` (everything returned as "unclassified") until an
on-prem model is configured, matching the existing `transcription_engine`/`transcription_reformat`
flip-a-switch pattern (`docs/architecture/dictation.md`, `docs/architecture/on-prem-model.md`). In stub
mode, "structuring" produces a single unclassified block — the clinician manually distributes text
across sections in the editable preview before creating the draft. This exercises the full pipeline
without requiring model access.
