# Medical Interpreter Prompt Template

**Version:** v1.0
**Status:** Pending CTO + Clinical Advisor + Regulatory Consultant sign-off (built per competitive-assessment "safe to add" item; not yet formally approved for real-patient use — see change control below)
**Change control:** Modifications require CTO + Clinical Advisor + Regulatory Consultant approval (CLAUDE.md §6 — new prompt template)

## Overview

Translates a short, clinician-authored (or staff-relayed) **communication message** between two languages — an explanation, an instruction, a question, or a patient's spoken words relayed back by staff. This is a **communication aid**, not a record summarizer or a content generator: the model never reads the patient record, only the message text supplied in the request.

Per the competitive assessment (Appendix A, row "Medical Interpreter"): classified **Enhance** — *"Communication, not clinical interpretation; keep clinical terms in source per §8."* Per `CLAUDE.md` §8, clinical terminology is preserved in source form and never translated: drug names, lab test names, diagnosis/condition names, and numeric values with their units stay exactly as written in the source, even mid-sentence in the translated output. Only the surrounding communication language is translated.

## Pipeline

```
[Clinician/staff-authored message, source language]
        ↓
[Interpreter prompt — translate only, no new content]
        ↓
[Blocklist gate — scanned against target-language patterns, retry up to 2×]
        ↓
[Translated message, or fallback to "use an in-person interpreter"]
```

Same retry/fallback shape as `narrative-prompt.md` and `patient-recap-prompt.md`: on a blocklist trigger, retry with a stricter instruction; after `MAX_RETRIES` exhausted, return `None` and the caller shows the fallback message rather than an unreviewed translation.

## System prompt (verbatim, `apps/narrative/src/narrative/interpreter.py`)

See the `_SYSTEM` constant in that file — the six numbered rules there are the authoritative source of truth; this doc summarizes them:

1. Translate only what is in the source message — no new content, no explanation, no elaboration.
2. No omissions — every part of the source message must appear in the translation.
3. Drug names, lab test names, diagnosis/condition names, numeric values, units, and reference ranges preserved verbatim — never translated, even mid-sentence.
4. May not interpret, infer, predict, prioritize, recommend, advise, warn, or characterize any value beyond what the source already states.
5. General communication language (greetings, instructions, questions, reassurance) translates naturally into the target language.
6. Empty or nonsensical source produces no output.

## Endpoint

`POST /narrative/interpret` (`apps/narrative/main.py`) — `{ text, source_language, target_language }` → `{ text, fallback_message, prompt_template_version, blocklist_triggered, blocklist_retries }`.

Wired end-to-end: `apps/core`'s `InterpreterController` (`POST /api/v1/patients/:id/interpreter/translate`, audited as `INTERPRETER_TRANSLATION_GENERATED`) and the web `InterpreterPanel` card, reachable from the Copilot workspace composer and Ctrl+K command bar.

## Known limitation

The blocklist scanner (`packages/blocklist`) only has compiled pattern sets for `en` and `ar`; other target languages fall back to the English pattern set (existing `scan()` behavior, not specific to this feature). Initial language selector in `InterpreterPanel` is scoped to English, Arabic, Urdu, Tagalog, and Hindi — the languages most relevant to KSA hospital staff and patient populations — rather than claiming the "80+ languages" breadth cited for competitors, since blocklist coverage for languages beyond en/ar has not been verified.
