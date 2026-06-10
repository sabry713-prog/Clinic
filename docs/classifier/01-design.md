# 01 — Query Classifier Design

**Version:** v1.0
**Status:** Authoritative

## Purpose

Classify every incoming Q&A question as **ALLOWED** (factual lookup) or **REFUSED** (interpretive). Run **before** retrieval and model synthesis.

This is the **primary control** that preserves the non-SaMD classification of the product. False negatives (allowing an interpretive question) are far worse than false positives (refusing a factual one).

## Two-layer architecture

```
                        ┌─────────────────────────────────┐
                        │  Question input                 │
                        └────────────┬────────────────────┘
                                     │
                        ┌────────────▼────────────────────┐
                        │  Layer 1 — Rule classifier       │
                        │  (deterministic, fast)           │
                        │                                  │
                        │  - Regex patterns                │
                        │  - Keyword + structure rules     │
                        │  - High-confidence determinations│
                        └────────────┬─────────────────────┘
                                     │
                ┌────────────────────┴──────────────────┐
                │                                       │
       Rule fires (decisive)                     No decisive rule
                │                                       │
                ▼                                       ▼
        Return rule result            ┌─────────────────────────────────┐
                                      │  Layer 2 — Model classifier      │
                                      │  (fine-tuned small model)        │
                                      │                                  │
                                      │  - Trained on labeled examples   │
                                      │  - Returns label + confidence    │
                                      └────────────┬─────────────────────┘
                                                   │
                                                   ▼
                                      ┌─────────────────────────────────┐
                                      │  Decision policy                 │
                                      │                                  │
                                      │  - If REFUSED: refuse            │
                                      │  - If ALLOWED with conf >= 0.85: │
                                      │      allow                       │
                                      │  - If ALLOWED with conf < 0.85:  │
                                      │      refuse with caution         │
                                      │      (log for review)            │
                                      └─────────────────────────────────┘
```

## Decision policy

The system is **biased toward refusing**. Specifically:
- Any rule layer match for an interpretive pattern → REFUSED (final, no model call)
- Model layer must produce **high confidence** (≥0.85) ALLOWED to actually allow
- ALLOWED with confidence < 0.85 is escalated to a "REFUSED with caution" message that explains the system is unsure and asks the clinician to rephrase as a specific factual lookup

This asymmetry is intentional. A frustrated clinician who has to rephrase is acceptable. An interpretive answer reaching a clinician is not.

## Return type

```python
@dataclass
class ClassifierResult:
    label: Literal["ALLOWED", "REFUSED"]
    confidence: float                         # 0.0 - 1.0
    layer: Literal["rule", "model"]           # which layer made the call
    refusal_category: Optional[str] = None    # if REFUSED
    rule_matches: list[str] = field(default_factory=list)
    reason_for_caution: Optional[str] = None  # for low-confidence refusals
```

## Rule layer

See `docs/classifier/02-rules.md` for the full rule set.

Implementation: a Python module `packages/classifier/rules.py` that returns:
- A definitive REFUSED (any interpretive pattern matched)
- A definitive ALLOWED (specific safe patterns matched, e.g., "what is the value of X")
- No decision (fall through to model layer)

Rules are **explicit, auditable, and fast** (regex on tokenized text, typically <1ms).

## Model layer

A small fine-tuned classifier. Requirements:
- Multilingual (Arabic + English)
- In-Kingdom inference
- Small enough for sub-200ms inference
- Trained on a curated labeled corpus (initial 2000 examples, growing over time)

### Training data

Initial corpus structure:
```
classifier_corpus/
├── allowed/
│   ├── en/
│   │   ├── labs.jsonl
│   │   ├── medications.jsonl
│   │   ├── vitals.jsonl
│   │   ├── procedures.jsonl
│   │   ├── history.jsonl
│   │   └── documents.jsonl
│   └── ar/
│       └── ... (same structure)
└── refused/
    ├── en/
    │   ├── trend_interpretation.jsonl
    │   ├── diagnostic_suggestion.jsonl
    │   ├── risk_assessment.jsonl
    │   ├── treatment_recommendation.jsonl
    │   ├── medication_safety.jsonl
    │   ├── differential_diagnosis.jsonl
    │   ├── prognostic.jsonl
    │   ├── red_flag.jsonl
    │   ├── comparative_judgment.jsonl
    │   └── out_of_scope.jsonl
    └── ar/
        └── ... (same structure)
```

Each line is JSON: `{"text": "...", "label": "ALLOWED"|"REFUSED", "category": "...", "language": "en"|"ar"}`.

Initial corpus assembled from:
- Hand-written by clinical advisor (200 examples)
- Augmented via paraphrasing (~1800)
- Cross-validated with second clinical reviewer

### Architecture options (decide in Slice 3)

1. **Fine-tuned sentence classifier** (DistilBERT-multilingual base) — preferred
2. **Few-shot LLM classifier** with strict prompt — faster to build, more expensive at runtime
3. **Rule-only** (no model layer) — fastest, but cannot handle ambiguous phrasings

Plan: start with (2) for Slice 3, migrate to (1) by end of Slice 5 once we have enough data.

## Evaluation

See `docs/classifier/03-evaluation.md`.

Acceptance criteria:
- Sensitivity for refusing interpretive queries: **≥ 98%** on the validation set
- Specificity for allowing factual queries: **≥ 90%**
- F1 on REFUSED class: **≥ 0.95**

## Edge cases

### Multi-intent questions

"What's the last creatinine, and is it getting worse?"

The question contains both an ALLOWED part ("what's the last creatinine") and a REFUSED part ("is it getting worse"). Policy: **the whole question is REFUSED with `category=COMPARATIVE_JUDGMENT`**, with offered facts being the recent creatinine values.

The refusal message explains:
> Your question includes both a factual lookup and a request for interpretation. I'll show you the values; you can interpret them.

### Code-switching (Arabic + English)

"ما هو آخر creatinine؟"

Both rule layer and model layer must handle this. Rule layer maps known clinical terms across languages (creatinine, BP, HR, RBC, etc.).

### Polite phrasings

"Could you please tell me when the patient was admitted?"

This is factually ALLOWED despite "could you". The rule layer must not blanket-refuse on "could you". Context matters.

### Implicit interpretive framing

"How sick is this patient?"

No explicit verb like "suggest" or "worsen". But the question asks for severity judgment. The model layer is needed here. The rule layer catches some patterns ("how sick", "how serious") explicitly.

### Empty/Nonsense

"asdfghjkl"

Treated as `OTHER_INTERPRETIVE` refusal with a generic message asking for clarification. No retrieval triggered.

## Versioning and change control

- Rule changes: PR review by CTO + Clinical Advisor
- Model retraining: requires evaluation report showing equal or better performance on validation set
- Every change increments the classifier version recorded in audit events
