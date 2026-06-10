"""Chunker — converts structured patient record data into text chunks.

Each resource type becomes one or more Chunk objects in both English and Arabic.
The Arabic variant for Slice 2 is the English text with an " [AR]" suffix;
real translation is deferred to when the foundation model is selected.
"""
from __future__ import annotations

from .types import (
    AllergyInput,
    Chunk,
    ConditionInput,
    DocumentInput,
    EncounterInput,
    MedicationInput,
    ObservationInput,
    PatientChunkInput,
)

_PASSAGE_LEN = 500
_PASSAGE_OVERLAP = 100


def _both(source_type: str, source_id: str, en_text: str, chunk_index: int = 0) -> list[Chunk]:
    """Return EN + AR (stub) variants for a single text."""
    return [
        Chunk(
            source_type=source_type,
            source_id=source_id,
            content_text=en_text,
            language="en",
            chunk_index=chunk_index,
        ),
        Chunk(
            source_type=source_type,
            source_id=source_id,
            content_text=en_text + " [AR]",
            language="ar",
            chunk_index=chunk_index,
        ),
    ]


def _chunk_observation(obs: ObservationInput) -> list[Chunk]:
    if obs.category == "vital-signs":
        text = (
            f"{obs.code_display}: "
            f"{obs.value_numeric if obs.value_numeric is not None else obs.value_text} "
            f"{obs.unit or ''} recorded {obs.effective_at}."
        ).strip()
    else:
        # laboratory
        low = obs.ref_range_low
        high = obs.ref_range_high
        range_part = (
            f" Reference range: {low}-{high} {obs.unit or ''}."
            if low is not None and high is not None
            else ""
        )
        text = (
            f"{obs.code_display} = "
            f"{obs.value_numeric if obs.value_numeric is not None else obs.value_text} "
            f"{obs.unit or ''} on {obs.effective_at}."
            f"{range_part} Status: {obs.status}."
        ).strip()
    return _both("Observation", obs.id, text)


def _chunk_medication(med: MedicationInput) -> list[Chunk]:
    text = (
        f"{med.medication_display} "
        f"{med.dose or ''} "
        f"{med.route or ''} "
        f"{med.frequency or ''}, "
        f"status {med.status}, "
        f"started {med.started_at or 'unknown'}, "
        f"prescriber {med.prescriber or 'unknown'}."
    ).strip()
    return _both("MedicationRequest", med.id, text)


def _chunk_condition(cond: ConditionInput) -> list[Chunk]:
    text = (
        f"Condition: {cond.code_display} "
        f"({cond.code_system}:{cond.code}), "
        f"status {cond.status}, "
        f"onset {cond.onset_date or 'unknown'}."
    ).strip()
    return _both("Condition", cond.id, text)


def _chunk_allergy(allergy: AllergyInput) -> list[Chunk]:
    text = (
        f"Allergy: {allergy.code_display}, "
        f"reaction {allergy.reaction or 'unknown'}, "
        f"severity {allergy.severity or 'unknown'}, "
        f"recorded {allergy.recorded_at or 'unknown'}."
    ).strip()
    return _both("AllergyIntolerance", allergy.id, text)


def _chunk_encounter(enc: EncounterInput) -> list[Chunk]:
    text = (
        f"Encounter: {enc.encounter_type}, "
        f"status {enc.status}, "
        f"started {enc.started_at or 'unknown'}, "
        f"ended {enc.ended_at or 'unknown'}, "
        f"ward {enc.ward or 'unknown'}, "
        f"bed {enc.bed or 'unknown'}."
    ).strip()
    return _both("Encounter", enc.id, text)


def _chunk_document(doc: DocumentInput) -> list[Chunk]:
    content = doc.content
    # Split into overlapping 500-char passages
    passages: list[str] = []
    if len(content) <= _PASSAGE_LEN:
        passages = [content]
    else:
        start = 0
        while start < len(content):
            end = start + _PASSAGE_LEN
            passages.append(content[start:end])
            start += _PASSAGE_LEN - _PASSAGE_OVERLAP
            if start >= len(content):
                break

    chunks: list[Chunk] = []
    for idx, passage in enumerate(passages):
        en_text = (
            f"{doc.doc_type} authored {doc.authored_at or 'unknown'} "
            f"by {doc.author or 'unknown'}: {passage}"
        )
        chunks.extend(_both("DocumentReference", doc.id, en_text, chunk_index=idx))
    return chunks


def chunk_patient_record(patient_data: PatientChunkInput) -> list[Chunk]:
    """Convert all resource types in *patient_data* into text chunks.

    Returns a flat list of Chunk objects (EN + AR variants for each resource).
    """
    chunks: list[Chunk] = []

    for obs in patient_data.observations:
        chunks.extend(_chunk_observation(obs))

    for med in patient_data.medications:
        chunks.extend(_chunk_medication(med))

    for cond in patient_data.conditions:
        chunks.extend(_chunk_condition(cond))

    for allergy in patient_data.allergies:
        chunks.extend(_chunk_allergy(allergy))

    for enc in patient_data.encounters:
        chunks.extend(_chunk_encounter(enc))

    for doc in patient_data.documents:
        chunks.extend(_chunk_document(doc))

    return chunks
