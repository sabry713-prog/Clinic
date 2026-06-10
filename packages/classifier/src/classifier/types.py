from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

CLASSIFIER_VERSION = "v1.0"


@dataclass
class ClassifierResult:
    label: Literal["ALLOWED", "REFUSED"]
    confidence: float
    layer: Literal["rule", "model"]
    refusal_category: Optional[str] = None
    rule_matches: list[str] = field(default_factory=list)
    reason_for_caution: Optional[str] = None
