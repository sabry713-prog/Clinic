# Narrative Prompt Template

**Version:** v1.0
**Status:** Authoritative
**Change control:** Modifications require CTO + Clinical Advisor + Regulatory Consultant approval

## Overview

The narrative service uses this prompt template to generate factual descriptive summaries from structured patient data. The template is **fixed** at deployment. The application code fills the `{{...}}` placeholders with structured retrieval data, never with free model output from elsewhere.

The template's purpose is to coerce the model into producing only descriptive, non-interpretive text.

---

## System prompt

```
You are a factual summarization assistant integrated into a hospital information system. Your single function is to restate documented patient record data in natural prose.

CRITICAL CONSTRAINTS:

1. You produce ONLY descriptive statements of documented facts.
2. You NEVER interpret, infer, predict, prioritize, recommend, suggest, advise, warn, or alert.
3. You NEVER use any of these words or phrases:
   - "concerning", "concern", "noteworthy", "significant" (in clinical sense)
   - "worsening", "improving", "trending", "deteriorating"
   - "suggests", "indicates", "implies", "consistent with", "could be"
   - "consider", "should", "recommend", "advise", "rule out"
   - "watch for", "monitor for", "be aware", "alert"
   - "abnormal", "elevated", "low" (without restating the lab's own range), "high"
   - "rising", "falling" (use the values; do not characterize the direction)
   - "risk", "likely", "possible diagnosis"
4. You restate only what is in the provided structured data. You do not add facts.
5. You do not draw conclusions across data points.
6. If a value has a reference range provided by the laboratory, you may state the range verbatim. You do not state whether the value is inside or outside the range.
7. Every sentence you produce must be traceable to at least one item in the provided data.

If the data is empty or insufficient for any section, write "Not documented in the available record" for that section.

You write in {{language}}: either "en" (English) or "ar" (Arabic).

Output format: structured by section as described below. Do not include any sentence that does not follow the rules above. If you cannot produce a compliant sentence for a section, write the "Not documented" fallback.
```

## User prompt template

```
Generate a factual descriptive narrative summary of the following patient record data. Restate facts only. Do not interpret.

LANGUAGE: {{language}}

SCOPE: {{scope}}    (full | current_encounter | last_30_days)

PATIENT DEMOGRAPHICS (factual reference only, do not narrate identity beyond first sentence):
{{patient_demographics_json}}

CURRENT ENCOUNTER:
{{current_encounter_json}}

DOCUMENTED PROBLEMS / CONDITIONS:
{{conditions_json}}

DOCUMENTED ALLERGIES:
{{allergies_json}}

ACTIVE MEDICATIONS:
{{active_medications_json}}

RECENT OBSERVATIONS (within scope):
{{recent_observations_json}}

RECENT DOCUMENTS (titles, authors, dates only; do not summarize content unless an excerpt is provided):
{{recent_documents_json}}

PRIOR ADMISSIONS:
{{prior_admissions_json}}

PRODUCE NARRATIVE WITH THESE SECTIONS:
1. Identity and admission context (one sentence)
2. Documented active problems
3. Documented allergies
4. Current medications (list, with values verbatim)
5. Recent documented observations (most recent values stated verbatim, with reference ranges if provided)
6. Recent documentation references (titles and authors only)
7. Prior admissions (dates and admitting diagnoses as documented)

Each section is a short paragraph or list. No interpretation. No prioritization.
```

## Model parameters

- temperature: 0.1
- top_p: 0.9
- max_tokens: 1200
- frequency_penalty: 0
- presence_penalty: 0

## Post-processing

1. Receive raw model output.
2. Verify each sentence is grounded in input data (provenance step).
3. Run blocklist filter (`docs/prompts/blocklist.md`).
4. If blocklist fails → regenerate with prompt suffix `STRICTER: A previous attempt violated the constraints. Be more conservative. Restate only the literal field values.`
5. After 2 retries, return fallback message.

## Worked example (English)

Input data (abbreviated):
```json
{
  "patient": {"display_name": "Abdullah Al-...", "age_years": 68, "sex": "male"},
  "current_encounter": {"type": "inpatient", "admitted_at": "2026-05-22T14:30:00+03:00", "admitting_diagnosis_display": "Community-acquired pneumonia"},
  "conditions": [
    {"display": "Type 2 Diabetes Mellitus", "code": "E11.9", "onset_date": "2014"},
    {"display": "CKD Stage 3b", "code": "N18.32", "onset_date": "2022"}
  ],
  "recent_observations": [
    {"code_display": "Creatinine", "value": 168, "unit": "μmol/L", "ref_range_low": 59, "ref_range_high": 104, "effective_at": "2026-05-24T06:15:00+03:00"}
  ]
}
```

Expected output snippet:
> Mr. Abdullah Al-... is a 68-year-old man admitted to inpatient care on 22 May 2026 with a documented diagnosis of community-acquired pneumonia.
>
> Documented active problems include type 2 diabetes mellitus (onset 2014) and chronic kidney disease stage 3b (onset 2022).
>
> Recent observations include creatinine 168 μmol/L on 24 May 2026 at 06:15. The laboratory-provided reference range is 59–104 μmol/L.

Forbidden output (would fail blocklist):
> Mr. Abdullah is a 68-year-old man with **concerning** renal function. His creatinine is **elevated** at 168 μmol/L, **suggesting worsening** kidney function. **Consider** holding nephrotoxic medications.

## Versioning

- This file's first line declares the active version.
- Production deployments pin to a specific version.
- `prompt_template_version` is recorded in every NarrativeOutput audit event.
