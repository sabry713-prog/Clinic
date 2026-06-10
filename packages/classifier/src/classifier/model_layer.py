"""Model classifier protocol and stub implementation."""
from __future__ import annotations

import re
from typing import Protocol, runtime_checkable

from .types import ClassifierResult

# Simple heuristic patterns for stub second-pass
_INTERPRETIVE_HEURISTIC = re.compile(
    r"\b(suggest|diagnos|worsen|deterior|risk|prognos|recommend|advise|alert|flag|"
    r"concern|worr|improv|trend|stable|unstable|predict|outcome|cause|differential)\b",
    re.IGNORECASE,
)


@runtime_checkable
class ModelClassifier(Protocol):
    async def classify(self, question: str, language: str) -> ClassifierResult: ...

    def version(self) -> str: ...


class StubModelClassifier:
    """
    Stub that runs a second-pass heuristic when rules don't fire.
    Returns ALLOWED with confidence 0.90 for questions ending with '?'
    that don't contain obviously interpretive language.
    Falls back to REFUSED with OTHER_INTERPRETIVE for nonsense/empty input.
    """

    def version(self) -> str:
        return "stub-model-v1"

    async def classify(self, question: str, language: str) -> ClassifierResult:
        stripped = question.strip()

        if not stripped:
            return ClassifierResult(
                label="REFUSED",
                confidence=0.99,
                layer="model",
                refusal_category="OTHER_INTERPRETIVE",
                rule_matches=[],
                reason_for_caution="Empty or nonsense input",
            )

        if _INTERPRETIVE_HEURISTIC.search(stripped):
            return ClassifierResult(
                label="REFUSED",
                confidence=0.80,
                layer="model",
                refusal_category="OTHER_INTERPRETIVE",
                rule_matches=[],
                reason_for_caution="Heuristic detected potentially interpretive language",
            )

        if stripped.endswith("?") or len(stripped) > 5:
            return ClassifierResult(
                label="ALLOWED",
                confidence=0.90,
                layer="model",
                refusal_category=None,
                rule_matches=[],
            )

        return ClassifierResult(
            label="REFUSED",
            confidence=0.75,
            layer="model",
            refusal_category="OTHER_INTERPRETIVE",
            rule_matches=[],
            reason_for_caution="Short or unclear input; cannot determine intent",
        )
