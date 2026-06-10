"""Shared types for the Q&A service."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AnswerSource:
    fact_segment: str
    type: str
    id: str
    code: str = ""
    source_system: str = ""
    field: str = ""


@dataclass
class RefusalResponse:
    text: str
    sources: list[AnswerSource] = field(default_factory=list)
    refusal_category: str = ""


@dataclass
class QAResponse:
    interaction_id: str
    patient_id: str
    conversation_id: str
    question: str
    classification: str  # "ALLOWED" | "REFUSED"
    classifier_confidence: float
    refusal_category: str
    rule_matches: list[str]
    language: str
    answer_text: str
    sources: list[AnswerSource]
    model_version: str
    prompt_template_version: str
    latency_ms: int
    disclaimer: str
    blocklist_triggered: bool
