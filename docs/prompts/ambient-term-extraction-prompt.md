# Ambient Medical-Term Extraction Prompt Template

**Version:** v1.0
**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off (built per explicit user
request on 2026-07-11, scoped via two rounds of clarifying questions to a read-only reference glossary
shown alongside the raw transcript — not a coding-suggestion feed, not a clinical summary). Not yet
formally approved for real-patient use.
**Change control:** Modifications require CTO + Clinical Advisor + Regulatory Consultant approval
(CLAUDE.md §6 item 1 — new prompt template; item 4 — new feature not enumerated in §1).

## Overview

Points out which existing spans of an already-transcribed dictation are medical terminology (medication,
symptom, diagnosis/condition, test/procedure) **without paraphrasing, summarizing, correcting, or adding
a single word**. The model's only job is to say which existing spans are medical vocabulary and what kind
of word each one is — the same "relocate, never rewrite" shape as
[`ambient-segmentation-prompt.md`](ambient-segmentation-prompt.md), applied to term-spotting instead of
note-section classification.

**Output is reference-only.** Unlike segmentation and condensation, extracted terms are never submitted
into a draft, never gain a `*_keys` flag, and never reach `draft.service.ts` — there is nothing here that
becomes part of the permanent record, so there is no draft-creation re-verification step. The glossary is
shown to the clinician purely as a reading aid next to the full raw transcript.

## Why this stays inside the non-SaMD Health IT boundary

Same mechanism as segmentation: the real safety gate is a server-side verbatim-substring check, not the
prompt. `apps/transcription/src/transcription/extract_terms.py` verifies every term the model returns via
`is_verbatim_substring()` (`apps/transcription/src/transcription/verbatim.py`, the same function
segmentation uses) — a term is kept only if it is a whitespace/case-insensitive substring of the source
transcript. Any term that fails is dropped silently, never partially trusted, never retried into existence
(terms are independent of each other, so a single bad term doesn't discard the good ones the way a failed
section classification does).

Categories (`medication`, `symptom`, `diagnosis_or_condition`, `test_or_procedure`, `other`) are a purely
**nominal/lexical** classification — what *kind* of word a term is, grammatically — never a judgment about
severity, urgency, or the patient's condition. This mirrors how segmentation classifies "which section"
without judging the content itself.

## What this does not do — and a real risk to state plainly

- **Terms are shown without their qualifiers, and that can change meaning if read in isolation.** The
  system prompt explicitly instructs the model to strip negation, duration, and degree words and return
  only the bare clinical term (rule 4 below) — so "no fever" surfaces as the term "fever." This is
  deliberate: qualifiers are exactly the kind of contextual nuance CLAUDE.md §2 already forbids this
  product from characterizing or interpreting (a negation is itself a judgment call about what to keep vs.
  drop if the model tried to preserve it selectively). The glossary is not a symptom list or a clinical
  assessment — it is a vocabulary index, always shown directly next to the full transcript, and the UI
  copy says so explicitly (`AmbientPanel.tsx`: *"reference only — read alongside the transcript above, not
  a clinical summary"*). The clinician resolves the actual clinical meaning by reading the transcript, not
  the glossary.
- No diagnosis, coding, recommendation, prioritization, or flagging by severity — terms are rendered as
  plain, unordered chips, never sorted or highlighted by clinical weight (CLAUDE.md §2).
- No effect on the draft or the patient record whatsoever — see "Overview" above.
- No always-on/background capture — inherits the same explicit Start/Stop + consent gate as the rest of
  ambient capture (`docs/architecture/ambient-capture.md`); term extraction only ever runs on a transcript
  the clinician already recorded and can see on screen.

## System prompt (verbatim, `apps/transcription/src/transcription/extract_terms.py`)

See the `_SYSTEM` constant in that file — the six numbered rules there are the authoritative source of
truth; this doc summarizes them:

1. Every term returned must be copied verbatim — no paraphrase, reword, translation, correction, or
   abbreviation expansion.
2. Only point out terms already in the transcript — no addition, no inference.
3. Classify each term into exactly one nominal category (medication, symptom, diagnosis_or_condition,
   test_or_procedure, other) — never a severity/judgment label.
4. Exclude ordinary words, filler, and the qualifiers around a term (negation, duration, degree) — return
   only the bare clinical term.
5. An empty array is a valid, complete answer when nothing in the transcript is medical terminology.
6. Output only a single JSON array of `{term, category}` objects — no commentary.

## Pipeline

```
[Raw transcript already captured and shown to the clinician — same transcript segmentation reviews]
        ↓
[Extraction fires automatically, alongside the transcript — POST /extract-terms]
        ↓
[Server-side verbatim-substring check on EVERY returned term; non-verbatim terms dropped, never trusted]
        ↓
[Case-insensitive de-dup]
        ↓
[Reference glossary rendered under the raw transcript, explicitly labeled reference-only]
```

There is no second stage — unlike segmentation/condensation, this output never enters
`prefill_sections`/`*_keys` and is never re-verified at draft-creation time, because it is never written
anywhere.

## Endpoints

- `POST /extract-terms` (`apps/transcription/main.py`) — `{text, language}` →
  `{terms: [{term, category}], retries}`.
- `POST /api/v1/patients/:id/ambient/extract-terms` (`apps/core/src/ambient/`) — core proxy, audited as
  `AMBIENT_TERMS_EXTRACTED` (metadata is `{term_count, retries}` only — no transcript text or extracted
  terms in audit metadata, PHI-adjacent).

## Known limitation

`transcription_term_extraction` defaults to `"stub"` (always returns an empty list) until an on-prem model
is configured, matching the existing `transcription_segmentation`/`transcription_condensation`
flip-a-switch pattern. Independent toggle from both — a site may want live segmentation without opting
into live term extraction, or vice versa. In stub mode the glossary panel simply never appears (an empty
list renders nothing), which exercises the full pipeline safely with no real model configured.
