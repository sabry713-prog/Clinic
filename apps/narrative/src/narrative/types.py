"""Shared types for the narrative service."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ProvenanceEntry:
    sentence_index: int
    char_start: int
    char_end: int
    sources: list[dict[str, str]] = field(default_factory=list)
    # each source: {"type": ..., "id": ..., "field": ...}


@dataclass
class NarrativeOutput:
    narrative_id: str
    patient_id: str
    text: str | None
    fallback_message: str | None
    provenance: list[ProvenanceEntry]
    model_version: str
    prompt_template_version: str
    generated_at: str
    language: str
    scope: str
    blocklist_triggered: bool
    blocklist_retries: int
