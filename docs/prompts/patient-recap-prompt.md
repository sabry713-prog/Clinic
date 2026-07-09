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

## System prompt (verbatim, `apps/narrative/src/narrative/patient_recap.py`)

See the `_SYSTEM` constant in that file — the eight numbered rules there are the authoritative source of truth; this doc summarizes them:

1. Reproduce only facts already in the source summary — no new content.
2. No omissions — every documented item in the source must still appear.
3. Clinical terms, values, units, ranges, dates preserved verbatim — no lay-term substitution.
4. May simplify sentence structure, use second person, expand abbreviations, warm tone.
5. May not interpret, infer, predict, prioritize, recommend, advise, warn, or characterize any value beyond what the source already states.
6. Same language as the source.
7. Empty/undocumented source stays empty/undocumented — never invented.

## Endpoint

`POST /narrative/patient-recap` (`apps/narrative/main.py`) — `{ narrative_text, language }` → `{ text, fallback_message, prompt_template_version, blocklist_triggered, blocklist_retries }`.

Not yet wired into `apps/core`'s narrative proxy or the web `NarrativePanel` — see the tracking task for that integration.
