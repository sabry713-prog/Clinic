"""Type definitions for the interpretive-language blocklist."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Category(str, Enum):
    INTERPRETIVE_VERB = "INTERPRETIVE_VERB"
    CLINICAL_JUDGMENT_ADJECTIVE = "CLINICAL_JUDGMENT_ADJECTIVE"
    TREND_LANGUAGE = "TREND_LANGUAGE"
    RECOMMENDATION = "RECOMMENDATION"
    ALERT_LANGUAGE = "ALERT_LANGUAGE"
    DIAGNOSTIC_INFERENCE = "DIAGNOSTIC_INFERENCE"
    RISK_LANGUAGE = "RISK_LANGUAGE"
    PROGNOSTIC = "PROGNOSTIC"


@dataclass
class BlocklistMatch:
    pattern: str
    span: tuple[int, int]
    category: str  # Category enum value
    matched_text: str


@dataclass
class BlocklistResult:
    passed: bool
    matches: list[BlocklistMatch] = field(default_factory=list)
    language: str = "en"
