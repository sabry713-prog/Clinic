# Draft Prompt Template — PROPOSAL (Phase E6)

**Version:** v0.1 (PROPOSAL — not yet authoritative)
**Status:** ⛔ Awaiting CTO + Clinical Advisor + Regulatory Consultant approval (CLAUDE.md §6)
**Do not wire into generation until this document is approved.**

## Purpose

Phase E6 lets the copilot **draft** the documents clinicians dislike writing —
discharge summary, referral letter, transfer note, clinic visit summary — by
**reassembling documented facts** into document form. The clinician edits and
signs. The system never authors new clinical judgement. This is generative
expansion **inside** the existing safety pipeline (retrieve → assemble →
generate → provenance-verify → blocklist), not around it.

## The section policy (the heart of E6 safety)

Every document type is a list of sections. Each section is one of:

- **assembled-facts** — the model may compose prose **from retrieved record
  data only** (same rules as the narrative). Used for identity, course,
  medications, results, etc.
- **clinician-authored-only** — the section may contain **only text the
  clinician previously authored in the record** (their own documented notes),
  verbatim or lightly reformatted. **The model never writes new content here.**
  This is enforced by an automated validator that rejects any output in these
  sections lacking a verbatim source match. **Assessment and Plan are always
  clinician-authored-only.**

## System prompt (proposed)

```
You are a clinical documentation assistant integrated into a hospital
information system. Your function is to assemble a DRAFT document from
documented patient-record facts for a clinician to review, edit, and sign.

CRITICAL CONSTRAINTS:

1. You produce ONLY a draft. It is unsigned and has no clinical authority.
2. For sections marked [ASSEMBLED-FACTS]: restate documented record data in
   plain prose. You do NOT interpret, infer, predict, prioritise, recommend,
   suggest, advise, warn, diagnose, or alert. Same forbidden vocabulary as the
   narrative prompt (see docs/prompts/narrative-prompt.md and the blocklist).
3. For sections marked [CLINICIAN-AUTHORED-ONLY] (always includes Assessment
   and Plan): reproduce ONLY text the clinician already authored in the record,
   verbatim or with whitespace/punctuation cleanup. You add NO new clinical
   content, wording, or meaning. If no authored text exists for the section,
   output exactly: "(No documented {section} to reproduce.)"
4. Every sentence must be traceable to a record entry. Preserve clinical terms,
   drug names, lab codes, numbers, units, and dates verbatim in source form.
5. You write in the requested language (en/ar). Clinical terminology is kept in
   source form and is never translated.

The draft is assembled from the RETRIEVED FACTS and AUTHORED SECTIONS provided.
You never introduce facts from outside this context.
```

## Document types & sections (proposed)

| Type | Sections (policy) |
|---|---|
| discharge_summary | Identity/Admission [AF]; Hospital Course [AF]; Documented Problems [AF]; Medications on Discharge [AF]; Results [AF]; **Assessment [CAO]**; **Plan / Follow-up [CAO]** |
| referral_letter | Identity [AF]; Reason for Referral [CAO]; Relevant History [AF]; Current Medications [AF]; Documented Findings [AF]; **Clinical Question [CAO]** |
| transfer_note | Identity/Admission [AF]; Course to Date [AF]; Active Problems [AF]; Medications [AF]; **Reason for Transfer [CAO]** |
| visit_summary | Identity [AF]; Documented Today [AF]; Results [AF]; Medications [AF]; **Assessment [CAO]**; **Plan [CAO]** |

`[AF]` = assembled-facts, `[CAO]` = clinician-authored-only.

## Guarantees (enforced in code, not just prompt)

- Provenance verification on every sentence (reuse narrative provenance).
- Blocklist filter is the final gate before the draft is stored/displayed.
- Section-policy validator rejects any model output in a `[CAO]` section that
  is not a verbatim substring of the clinician's authored source text.
- A draft is a draft: **unsigned drafts cannot be exported, printed, or filed.**
  Sign-off is an explicit, audited clinician action.

## Open questions for review

1. Confirm the section policy per document type (above).
2. Confirm "lightly reformatted" scope for `[CAO]` (whitespace/punctuation only?).
3. Confirm the empty-section sentinel wording (EN/AR).
