# Ambient Section Condensation Prompt Template

**Version:** v1.0
**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off (built per
competitive-assessment "gray-area" backlog item, scoped via explicit user decision on 2026-07-11 to
build real condensation for non-judgment sections only, with Assessment/Plan remaining permanently
verbatim-only — see change control below). Not yet formally approved for real-patient use.
**Change control:** Modifications require CTO + Clinical Advisor + Regulatory Consultant approval
(CLAUDE.md §6 item 1 — new prompt template; item 3 — blocklist reuse; item 4 — new feature not
enumerated in §1).

## Overview

Lightly paraphrases/tightens ONE ambient-capture note section — Chief Complaint or History only,
never Assessment or Plan — into standard note-style prose. Unlike `ambient-segmentation-prompt.md`
(which only *relocates* verbatim spans, never altering a word), this genuinely lets the model rewrite
text: removing filler and conversational padding, reordering for clarity. This is the first place in
this codebase an AI paraphrases clinical content rather than either reproducing it verbatim or
generating prose from already-structured, already-vetted record data (`narrative-prompt.md`'s job).

## Why this stays inside the non-SaMD Health IT boundary

Two independent, mandatory checks — both must pass, or the condensation is discarded and the original
verbatim text is used instead:

1. **Blocklist scan** (`packages/blocklist`, same regex gate `narrative_service.py` and
   `patient_recap.py` already use) — no interpretive/judgment/trend/recommendation language.
2. **Content-word containment** (`apps/transcription/src/transcription/condense.py`
   `word_containment_check()`) — every content word (≥3 characters, stopwords excluded) in the
   condensed output must already appear somewhere in the source verbatim text. This is the check that
   makes condensation safe: blocklist alone catches *judgment* language, but the input here is raw,
   unvetted transcript content (not curated structured facts), so there's a real risk of the model
   silently introducing a new clinical claim ("mentioned some fever" → "has an infection") that isn't
   interpretive-*sounding* but is still fabricated. Containment catches exactly that.
   - This is exact-word matching, not stemming — "fever" and "febrile" are different words to this
     check. A synonym substitution is (correctly, conservatively) rejected the same as a fabricated new
     term would be.

**Assessment/Plan can never reach this pipeline.** `CONDENSABLE_SECTIONS = {"chief_complaint",
"history"}` is a hard, server-side constant enforced in *three* independent places: `condense.py`
(never generates for other keys), `draft.service.ts` (a client claiming a non-member key was
"condensed" is silently ignored — that section still goes through the strict
`isClinicianAuthoredOnly()` verbatim-substring check regardless), and the frontend (`AmbientPanel.tsx`
never renders a Condense button for Assessment/Plan). This is deliberate defense in depth, not reliance
on any single layer.

**Human-in-the-loop remains the final gate**, unchanged from every other draft flow: a condensed
suggestion is only ever a *proposal* the clinician must explicitly accept (a distinct "Use condensed
version" click, never a default) before it replaces the section text — same "AI suggests, clinician
confirms" shape as ICD-10/SBS coding suggestions.

**Retry-then-fallback** mirrors `narrative_service.py`'s exact shape: up to 2 retries with a stricter
suffix appended, then fall back to the **original verbatim text, unchanged** — never fabricate, never
block the note.

**Stub mode is safe by construction.** The default (no real LLM configured,
`transcription_condensation=stub`) condenser does *subtractive-only* extractive condensation — strips a
small deterministic list of filler words/phrases ("um", "uh", "you know", "the patient said", etc.) and
collapses whitespace. A transform that only removes words can never introduce a new one, so it always
passes `word_containment_check` by construction and virtually always passes blocklist too. Real
paraphrasing only happens when `transcription_condensation=llm` is explicitly configured — same
flip-a-switch pattern as `transcription_segmentation`, and inherits the same §7 PHI/on-Kingdom caveat
already documented for the narrative model in `docs/architecture/on-prem-model.md` (not re-litigated
here).

## What this does not do

- Never touches Assessment or Plan — see the three-layer enforcement above.
- Never infers severity, urgency, or draws any conclusion — rule 2 of the system prompt below.
- Never introduces a clinical term/fact/concept not already explicitly in the source text — enforced by
  `word_containment_check`, not just instructed in the prompt.
- Nothing is applied automatically — every condensation is a discardable suggestion until the clinician
  explicitly accepts it, and nothing is written to the patient record until "Create draft" and,
  ultimately, sign-off — identical guarantees to the rest of the draft lifecycle.

## System prompt

```
You condense one section of a clinical encounter note into tighter, standard note-style prose.

ABSOLUTE RULES:
1. Do NOT add any clinical fact, term, finding, diagnosis, severity, or instruction that is not already explicitly present in the source text.
2. Do NOT interpret, infer, or draw any conclusion -- including about severity or urgency.
3. You MAY remove filler words and conversational padding, reorder for clarity, and use standard abbreviations for terms already stated.
4. Preserve all clinical terms, medication names, doses, and quantities EXACTLY as given.
5. Output ONLY the condensed section text. No commentary, no markdown, no explanation.
```

## Stricter suffix

```
STRICTER: Do not introduce any word or concept not already present in the source text. Only remove filler, reorder for clarity, or use standard abbreviations for terms already stated.
```

## Pipeline

```
[Segmented section text, verbatim (see ambient-segmentation-prompt.md)]
        ↓
[Clinician clicks "Condense" on Chief Complaint or History ONLY -- no button exists for Assessment/Plan]
        ↓
[POST /condense -- retry up to 2x on blocklist OR containment failure]
        ↓
[Server-side blocklist scan + word-containment check on EVERY attempt, in validate_condensation()]
        ↓ (exhausted retries -> falls back to original verbatim text, condensed=false)
[Suggestion shown to clinician -- "Use condensed version" / "Keep original", never auto-applied]
        ↓ (clinician explicitly accepts)
[POST /api/v1/patients/:id/drafts with prefill_sections + condensed_keys --
 re-validated AGAIN via /validate-condensation in draft.service.ts, independent of the original proposal]
        ↓
[Normal encounter_note draft: edit / sign / export -- unchanged E6 lifecycle]
```

Note the **double validation**, same discipline as segmentation: once when the condensation is first
proposed, and again — independently, never trusting the client's "this passed" claim — when the draft
is actually created.

## Endpoints

- `POST /condense` (`apps/transcription/main.py`) — `{section_key, text, language}` →
  `{text, condensed, retries}`.
- `POST /validate-condensation` (`apps/transcription/main.py`) — validation-only, no generation —
  `{condensed_text, source_text, language}` → `{valid}`. Used by `apps/core`'s `draft.service.ts` to
  re-verify server-side at draft-creation time.
- `POST /api/v1/patients/:id/ambient/condense` (`apps/core/src/ambient/`) — core proxy, audited as
  `AMBIENT_SECTION_CONDENSED` (no section text in audit metadata).
- `POST /api/v1/patients/:id/drafts` with `document_type: "encounter_note"`, `prefill_sections`, and
  `condensed_keys` — see `ambient-segmentation-prompt.md`'s endpoint section for the base shape.

## Known limitation

`transcription_condensation` defaults to `"stub"` (safe subtractive-only filler-strip) until an
on-prem model is configured — independent toggle from `transcription_segmentation` on purpose, since a
site may want live segmentation without opting into live condensation. In stub mode, "condensation" is
genuinely useful (strips real filler) but modest — no true paraphrasing happens until `llm` mode is
explicitly configured and signed off on.
