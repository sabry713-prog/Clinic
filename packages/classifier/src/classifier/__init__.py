"""Query classifier package — Slice 3 full implementation."""
from __future__ import annotations

from .classifier import classify
from .model_layer import ModelClassifier, StubModelClassifier
from .rules import apply_rules
from .types import CLASSIFIER_VERSION, ClassifierResult

__all__ = [
    "classify",
    "apply_rules",
    "ClassifierResult",
    "CLASSIFIER_VERSION",
    "ModelClassifier",
    "StubModelClassifier",
]
