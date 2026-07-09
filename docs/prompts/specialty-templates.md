# Specialty Templates

**Status:** Pending CTO + Clinical Advisor sign-off (built per competitive-assessment "safe to add"
item; not yet formally approved for real-patient use — see change control below). No Regulatory
Consultant sign-off required per CLAUDE.md §6 item 3, since this feature involves **no generative
model and no prompt template** — see Overview.
**Change control:** New feature not enumerated in CLAUDE.md §1 — requires CTO + Clinical Advisor
approval (CLAUDE.md §6 item 4) before real-patient use.

## Overview

Per the competitive assessment (Appendix A, row "Specialty templates (note/summary formats)"):
classified **Enhance**, rationale *"Templating / terminology only; no judgment."*

Document drafting (`apps/core/src/draft/draft.service.ts`, phase E6) was already **entirely
deterministic** before this feature: it assembles documented facts via fixed SQL queries and a fixed
per-document-type section skeleton — no LLM, no generative prompt, no interpretive step. Specialty
templates extend that same deterministic pipeline with an optional `specialty` parameter that:

1. Overrides a handful of section **titles** with specialty-conventional terminology (e.g. "Documented
   Problems" → "Cardiac Problem List" for cardiology). The section's assembled **content** is
   identical — same SQL query, same rows, same formatting — only the label text differs.
2. For any non-`general` specialty, inserts an **Allergies** section (deterministically reproducing
   `hospital.allergy_intolerance`, verbatim reaction term, no severity adjective — same rule as
   `docs/prompts/narrative-prompt.md` §3) immediately after Identity. This section did not exist in
   any document type before this feature and is universally relevant regardless of specialty.

`specialty: "general"` (the default) is **byte-identical** to the pre-existing template — no
regression to already-reviewed default drafting behavior.

## Supported specialties

`general` (default) · `cardiology` · `orthopedics` · `pediatrics` · `obstetrics_gynecology` ·
`emergency_medicine`

## Why no Regulatory Consultant sign-off gate

CLAUDE.md §6 item 3 requires Regulatory Consultant sign-off specifically for changes to **prompt
templates** (`docs/prompts/`) that feed a generative model, because that is where interpretive
language could leak into generated text. This feature adds no new prompt and calls no model — it is
pure string/section-skeleton composition, identical in kind to the pre-existing `TEMPLATES` map in
`draft.service.ts` that this feature extends. It still requires CTO + Clinical Advisor sign-off as any
new product-facing feature would (§6 item 4).

## Where it's implemented

- `apps/core/src/draft/draft.service.ts`: `SPECIALTY_TITLE_OVERRIDES`, `SPECIALTIES`, and the
  `generate()` `specialty` parameter.
- `apps/core/migrations/1719300000000_draft-specialty.ts`: `app.document_draft.specialty` column
  (audit/traceability of which template was used; defaults to `'general'`).
- `apps/web/src/components/DraftPanel/DraftPanel.tsx`: specialty selector next to document type.

Tested in `apps/core/src/draft/draft.service.spec.ts`: `general` output is unchanged, specialty
overrides change only titles (never assembled content), the Allergies section is inserted for
non-general specialties only, and Arabic title lookup resolves correctly.
