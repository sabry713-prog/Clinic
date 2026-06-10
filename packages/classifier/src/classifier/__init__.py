"""
Query classifier package.

Slice 0 stub — always returns ALLOWED with confidence 1.0.
Real implementation ships in Slice 2.
"""
from __future__ import annotations

from enum import Enum
from pydantic import BaseModel


class Classification(str, Enum):
    ALLOWED = "ALLOWED"
    REFUSED = "REFUSED"


class ClassifierResult(BaseModel):
    classification: Classification
    confidence: float
    refusal_category: str | None = None
    rule_matches: list[str] = []


def classify(question: str, language: str = "ar") -> ClassifierResult:
    """Stub classifier — always allows. Replace in Slice 2."""
    return ClassifierResult(
        classification=Classification.ALLOWED,
        confidence=1.0,
    )
