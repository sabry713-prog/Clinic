# Q&A Refusal Response Prompt

**Version:** v1.0
**Status:** Authoritative

## Context

Used when the classifier labels a question REFUSED. The refusal generator builds a helpful, conversational refusal that:
1. States that the system does not interpret clinical data
2. Offers the underlying facts the clinician can interpret themselves (when applicable)

The refusal MUST NOT itself contain interpretive language.

## Refusal generation strategy

Most refusals are template-driven, not model-generated, for safety. The model is used **only** to phrase the templated content naturally.

### Refusal categories → response templates

| Category | Template (English) | Template (Arabic) |
|---|---|---|
| `TREND_INTERPRETATION` | "I don't interpret clinical trends. Here are the documented values:\n\n{values_list}\n\nLaboratory-provided reference range, when available, is shown alongside each value." | "لا أقوم بتفسير الاتجاهات السريرية. هذه هي القيم الموثقة:\n\n{values_list}\n\nالنطاق المرجعي من المختبر معروض بجانب كل قيمة عند توفره." |
| `DIAGNOSTIC_SUGGESTION` | "I don't suggest diagnoses. The documented problems for this patient are:\n\n{conditions_list}" | "لا أقترح تشخيصات. المشاكل الموثقة لهذا المريض هي:\n\n{conditions_list}" |
| `RISK_ASSESSMENT` | "I don't perform risk assessments. I can show you specific documented facts if you have a more specific factual question." | "لا أقوم بتقييم المخاطر. يمكنني عرض حقائق موثقة محددة إذا كان لديك سؤال أكثر تحديداً." |
| `TREATMENT_RECOMMENDATION` | "I don't recommend treatments. The currently documented active medications are:\n\n{medications_list}" | "لا أوصي بالعلاجات. الأدوية الفعّالة الموثقة حالياً هي:\n\n{medications_list}" |
| `MEDICATION_SAFETY_JUDGMENT` | "I don't assess medication safety. The patient's current medications, allergies, and recent laboratory values are:\n\nMedications:\n{medications_list}\n\nAllergies:\n{allergies_list}\n\nRecent labs:\n{relevant_labs_list}" | (corresponding Arabic) |
| `DIFFERENTIAL_DIAGNOSIS` | "I don't suggest differential diagnoses. Documented problems and recent observations are available — ask me a specific factual question." | (corresponding Arabic) |
| `PROGNOSTIC_QUESTION` | "I don't predict outcomes. I can show you the current encounter status and history of prior admissions." | (corresponding Arabic) |
| `RED_FLAG_IDENTIFICATION` | "I don't identify clinical red flags. You can ask me specific factual questions about labs, vitals, medications, allergies, or documented problems." | (corresponding Arabic) |
| `COMPARATIVE_JUDGMENT` | "I show values without characterizing them as better or worse. Here are the values you asked about:\n\n{values_list}" | (corresponding Arabic) |
| `OUT_OF_SCOPE` | "I can only answer factual questions about the currently selected patient. Cross-patient or cohort questions are not supported in this version." | (corresponding Arabic) |
| `OTHER_INTERPRETIVE` | "I answer factual questions about this patient's record. The question you asked requires interpretation, which I do not perform. Please rephrase as a factual lookup, or review the record directly." | (corresponding Arabic) |

## Fact-offering logic

Some refusals include relevant facts. The offer is built **from structured retrieval**, not from model generation.

For each refusal category, the application:

| Category | Offer |
|---|---|
| `TREND_INTERPRETATION` | If the question references a measurable (e.g., "kidney function", "creatinine", "blood pressure"), fetch last N values of the inferred measurable. Use a lightweight lookup table of question-term → observation-code. |
| `DIAGNOSTIC_SUGGESTION` | Pull active conditions from `hospital.condition` where `status = 'active'`. |
| `TREATMENT_RECOMMENDATION` | Pull active medications. |
| `MEDICATION_SAFETY_JUDGMENT` | Pull active medications + allergies + relevant labs (renal, hepatic). |
| `COMPARATIVE_JUDGMENT` | Pull the values implied by the question (same mapping as TREND_INTERPRETATION). |

If the application cannot confidently infer what to offer, it skips the offer and uses the generic refusal text only.

## Implementation note

The refusal flow is **deterministic** (no LLM):

```python
def build_refusal(question: str, category: str, patient_id: UUID, language: str) -> RefusalResponse:
    template = REFUSAL_TEMPLATES[category][language]

    offered_facts = []
    if category in CATEGORIES_WITH_FACT_OFFERS:
        offered_facts = fetch_offerable_facts(question, category, patient_id, language)

    text = template.format(
        values_list=format_values(offered_facts.get('values')),
        conditions_list=format_conditions(offered_facts.get('conditions')),
        medications_list=format_medications(offered_facts.get('medications')),
        allergies_list=format_allergies(offered_facts.get('allergies')),
        relevant_labs_list=format_labs(offered_facts.get('labs')),
    )

    # Blocklist filter as safety net even though we built deterministically
    if not blocklist_passes(text):
        return generic_refusal(language)

    return RefusalResponse(
        text=text,
        sources=collect_sources(offered_facts),
        refusal_category=category,
    )
```

## Examples

### Question: "Is the kidney function getting worse?"

Classified: `TREND_INTERPRETATION` (rule match)
Inferred measurable: creatinine (from "kidney function" → renal code group)
Offered facts: last 5 creatinine observations

Response:
> I don't interpret clinical trends. Here are the documented values:
>
> • 24 May 2026 — Creatinine 168 μmol/L
> • 23 May 2026 — Creatinine 152 μmol/L
> • 22 May 2026 — Creatinine 148 μmol/L
> • 14 Apr 2026 — Creatinine 138 μmol/L
> • 10 Mar 2026 — Creatinine 141 μmol/L
>
> Laboratory-provided reference range: 59–104 μmol/L.

### Question: "What should I prescribe for his pain?"

Classified: `TREATMENT_RECOMMENDATION`
Offered facts: active medications

Response:
> I don't recommend treatments. The currently documented active medications are:
>
> • Metformin 500 mg orally twice daily
> • Lisinopril 20 mg orally daily
> • ...

### Question: "How are all CKD patients doing this month?"

Classified: `OUT_OF_SCOPE` (rule match on cohort intent)
Offered facts: none

Response:
> I can only answer factual questions about the currently selected patient. Cross-patient or cohort questions are not supported in this version.

## Versioning

Refusal templates have their own version field. Recorded in `qa_interaction.prompt_template_version` as `refusal-v1.0`.
