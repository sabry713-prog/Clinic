"""Type definitions for the retrieval package."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SourceRef:
    type: str   # e.g. "Observation", "Condition", "MedicationRequest"
    id: str
    field: str = ""


@dataclass
class Chunk:
    """A single text chunk derived from a patient record resource."""

    source_type: str
    source_id: str
    content_text: str
    language: str  # "en" | "ar"
    chunk_index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievalResult:
    """A ranked retrieval result returned by hybrid_retrieve()."""

    chunk_id: str
    source_type: str
    source_id: str
    content_text: str
    score: float
    vector_rank: int | None = None
    bm25_rank: int | None = None
    language: str = "en"
    # retrieval_chunk has no effective_at column; stays None unless a future
    # schema change surfaces it
    effective_at: str | None = None


# ── Input types for chunker ───────────────────────────────────────────────────

@dataclass
class ObservationInput:
    id: str
    category: str  # "laboratory" | "vital-signs"
    code_display: str
    value_numeric: float | None
    value_text: str | None
    unit: str | None
    ref_range_low: float | None
    ref_range_high: float | None
    effective_at: str  # ISO datetime string
    status: str


@dataclass
class MedicationInput:
    id: str
    medication_display: str
    dose: str | None
    route: str | None
    frequency: str | None
    status: str
    started_at: str | None
    prescriber: str | None


@dataclass
class ConditionInput:
    id: str
    code_display: str
    code_system: str
    code: str
    status: str
    onset_date: str | None


@dataclass
class AllergyInput:
    id: str
    code_display: str
    reaction: str | None
    severity: str | None
    recorded_at: str | None


@dataclass
class EncounterInput:
    id: str
    encounter_type: str
    status: str
    started_at: str | None
    ended_at: str | None
    ward: str | None
    bed: str | None


@dataclass
class DocumentInput:
    id: str
    doc_type: str
    authored_at: str | None
    author: str | None
    content: str


@dataclass
class PatientChunkInput:
    patient_id: str
    observations: list[ObservationInput] = field(default_factory=list)
    medications: list[MedicationInput] = field(default_factory=list)
    conditions: list[ConditionInput] = field(default_factory=list)
    allergies: list[AllergyInput] = field(default_factory=list)
    encounters: list[EncounterInput] = field(default_factory=list)
    documents: list[DocumentInput] = field(default_factory=list)
