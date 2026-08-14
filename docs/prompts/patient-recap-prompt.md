# Patient Recap Prompt Template

**Version:** v1.0
**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off (built per competitive-assessment "safe to add" item; not yet formally approved for real-patient use — see change control below)
**Change control:** Modifications require CTO + Clinical Advisor + Regulatory Consultant approval (CLAUDE.md §6 — new prompt template)

## Overview

Restyles an **already-generated, already-blocklist-passed** clinician narrative into prose a patient can read comfortably — shorter sentences, second-person address, spelled-out abbreviations. It is a second pass over already-approved facts, not a new content-generation step: the model never sees raw patient data, only the finished narrative text.

This is the boundary-safe version of the "patient-facing plain-language recap" pattern (Abridge's top-cited differentiator in the competitive assessment). It does **not** translate clinical terminology into lay synonyms — per `CLAUDE.md` §8 ("clinical terminology... preserved in source form; do not translate"), diagnosis names, drug names, lab names, values, units, and dates are reproduced **verbatim**. Only sentence structure, tone, and framing change.

## Pipeline

```
[Clinician narrative — already blocklist-passed]
        ↓
[Patient recap prompt — restyle only, same facts]
        ↓
[Blocklist gate — scanned again, retry up to 2×]
        ↓
[Patient-friendly text, or fallback to the clinical summary]
```

Same retry/fallback shape as `narrative-prompt.md`: on a blocklist trigger, retry with a stricter instruction; after `MAX_RETRIES` exhausted, return `None` and the caller falls back to showing the original clinician narrative rather than an unreviewed recap.

## System prompt

```
You restyle an already-approved factual clinical summary into a version a patient can read comfortably. You do NOT generate new clinical content.

ABSOLUTE RULES:
1. Reproduce ONLY the facts already present in the source summary. Do not add, infer, expand, or supply any clinical content, finding, diagnosis, recommendation, or value not already stated.
2. Do NOT omit any documented fact from the source. Every condition, medication, lab value, and date in the source must still appear.
3. Preserve VERBATIM: diagnosis/condition names, drug names, lab test names, numeric values, units, reference ranges, and dates. Do not substitute a lay synonym for any clinical term (e.g. do not change "hypertension" to "high blood pressure") -- reproduce the term exactly as documented.
4. You MAY: shorten and simplify sentence structure, write in second person ("Your record shows..."), spell out abbreviations, and use a warmer tone.
5. You may NOT: interpret, infer, predict, prioritize, recommend, advise, warn, or characterize any value as high/low/normal/abnormal/concerning/improving/worsening beyond what the source text itself already states.
6. Write in the SAME language as the source summary.
7. If the source is empty or says "Not documented", say so plainly -- do not invent content.

Output ONLY the restyled recap text -- no preamble, no commentary.
```

## Endpoint

`POST /narrative/patient-recap` (`apps/narrative/main.py`) — `{ narrative_text, language }` → `{ text, fallback_message, prompt_template_version, blocklist_triggered, blocklist_retries }`.

Wired end-to-end: `apps/core`'s narrative proxy (`POST /api/v1/patients/:id/narrative/:narrative_id/patient-recap`, audited as `NARRATIVE_PATIENT_RECAP_GENERATED`) and the web `NarrativePanel` "Patient recap" toggle. See `docs/api/04-narrative.md`.
