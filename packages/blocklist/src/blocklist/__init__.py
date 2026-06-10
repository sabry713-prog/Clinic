"""
Interpretive-language blocklist filter.

Guards generated text from crossing the Health IT → SaMD boundary.
The blocklist terms are in docs/prompts/blocklist.md.
This is a stub for Slice 0 — real pattern matching ships in Slice 2.
"""
from __future__ import annotations

from pydantic import BaseModel


class BlocklistResult(BaseModel):
    passed: bool
    matched_terms: list[str] = []


# Minimal seed blocklist — full list is in docs/prompts/blocklist.md
_BLOCKED_TERMS_EN = [
    "worsening",
    "improving",
    "concerning",
    "trending",
    "suggests",
    "indicates",
    "consistent with",
    "likely",
    "probably",
    "recommend",
    "should consider",
    "differential",
]

_BLOCKED_TERMS_AR = [
    "تدهور",
    "تحسن",
    "يشير",
    "يوحي",
    "يُرجَّح",
    "توصية",
    "ينصح",
]


def check(text: str, language: str = "ar") -> BlocklistResult:
    """
    Check generated text for interpretive language.

    Returns passed=True if no blocked terms found.
    The caller must retry generation if passed=False.
    """
    lower = text.lower()
    matched: list[str] = []

    terms = _BLOCKED_TERMS_AR if language == "ar" else _BLOCKED_TERMS_EN
    for term in terms:
        if term.lower() in lower:
            matched.append(term)

    return BlocklistResult(passed=len(matched) == 0, matched_terms=matched)
