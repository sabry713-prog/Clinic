# Classifier Evaluation Corpus

This directory contains labeled examples used to evaluate the query classifier.

## Structure

```
corpus/
├── holdout/          # Frozen holdout set — never used for training
│   ├── en/
│   │   ├── allowed.jsonl   (50 examples)
│   │   └── refused.jsonl   (50 examples, multi-category)
│   └── ar/
│       ├── allowed.jsonl   (20 examples)
│       └── refused.jsonl   (20 examples)
└── stress/           # Stress / edge cases — grown over time
    ├── borderline.jsonl       (20 tricky cases)
    ├── code_switching.jsonl   (10 mixed Arabic/English)
    └── polite_phrasings.jsonl (10 verbose factual questions)
```

## Schema

Each JSONL line is a JSON object with:

```json
{
  "text": "The question text",
  "label": "ALLOWED" | "REFUSED",
  "category": "TREND_INTERPRETATION",   // present for REFUSED only
  "language": "en" | "ar",
  "note": "optional human annotation"   // stress corpus only
}
```

## Refusal categories

| Category | Description |
|---|---|
| `TREND_INTERPRETATION` | Asks whether a value is improving/worsening/trending |
| `DIAGNOSTIC_SUGGESTION` | Asks for a diagnosis or differential |
| `TREATMENT_RECOMMENDATION` | Asks what to prescribe, adjust, or do |
| `MEDICATION_SAFETY_JUDGMENT` | Asks if a drug is safe/contraindicated |
| `RISK_ASSESSMENT` | Asks about prognosis, severity, or risk |
| `REFERRAL_RECOMMENDATION` | Asks whether to consult, order, or refer |
| `LAB_INTERPRETATION` | Asks if a value is normal, abnormal, or significant |

## Change control

The holdout corpus is **frozen**. Additions require:
1. CTO approval (CLAUDE.md §6)
2. Clinical advisor review
3. Documented rationale in the PR description

The stress corpus may be grown by the engineering team without approval, but
additions must be reviewed in the weekly clinical panel meeting.
