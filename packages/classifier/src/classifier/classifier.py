"""Main classify() entry point — orchestrates rule → model → policy."""
from __future__ import annotations

import re
from typing import Optional

from .model_layer import ModelClassifier, StubModelClassifier
from .rules import apply_rules
from .types import CLASSIFIER_VERSION, ClassifierResult

# Strip «...» quotes before processing
_QUOTE_PATTERN = re.compile(r"«[^»]*»")


def _preprocess(question: str) -> str:
    """Strip quotation markers used for source quoting."""
    return _QUOTE_PATTERN.sub("", question).strip()


async def classify(
    question: str,
    language: str = "en",
    model: Optional[ModelClassifier] = None,
) -> ClassifierResult:
    """
    Classify a clinical question as ALLOWED or REFUSED.

    Steps:
    1. Pre-process: strip «...» quotes
    2. Try rule layer (REFUSED rules first, then ALLOWED rules)
    3. If decisive rule → return immediately
    4. Fall through to model layer
    5. Apply decision policy:
       - model REFUSED → REFUSED
       - model ALLOWED with conf >= 0.85 → ALLOWED
       - model ALLOWED with conf < 0.85 → REFUSED with reason_for_caution
    """
    cleaned = _preprocess(question)

    category, rule_matches = apply_rules(cleaned)

    if category is not None and category != "ALLOWED_FACTUAL":
        # A REFUSED rule fired
        return ClassifierResult(
            label="REFUSED",
            confidence=0.99,
            layer="rule",
            refusal_category=category,
            rule_matches=rule_matches,
        )

    if category == "ALLOWED_FACTUAL":
        return ClassifierResult(
            label="ALLOWED",
            confidence=0.99,
            layer="rule",
            refusal_category=None,
            rule_matches=rule_matches,
        )

    # No decisive rule — fall through to model
    _model = model if model is not None else StubModelClassifier()
    model_result = await _model.classify(cleaned, language)

    if model_result.label == "REFUSED":
        return ClassifierResult(
            label="REFUSED",
            confidence=model_result.confidence,
            layer="model",
            refusal_category=model_result.refusal_category or "OTHER_INTERPRETIVE",
            rule_matches=model_result.rule_matches,
            reason_for_caution=model_result.reason_for_caution,
        )

    # ALLOWED — apply confidence threshold
    if model_result.confidence >= 0.85:
        return ClassifierResult(
            label="ALLOWED",
            confidence=model_result.confidence,
            layer="model",
            refusal_category=None,
            rule_matches=model_result.rule_matches,
        )
    else:
        return ClassifierResult(
            label="REFUSED",
            confidence=model_result.confidence,
            layer="model",
            refusal_category="OTHER_INTERPRETIVE",
            rule_matches=model_result.rule_matches,
            reason_for_caution=model_result.reason_for_caution
            or f"Model confidence {model_result.confidence:.2f} below threshold 0.85",
        )
