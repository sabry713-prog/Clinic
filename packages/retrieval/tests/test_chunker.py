"""Unit tests for the patient record chunker."""
from __future__ import annotations

import pytest

from retrieval.chunker import chunk_patient_record
from retrieval.types import (
    AllergyInput,
    ConditionInput,
    DocumentInput,
    EncounterInput,
    MedicationInput,
    ObservationInput,
    PatientChunkInput,
)


def _make_lab_obs() -> ObservationInput:
    return ObservationInput(
        id="obs-001",
        category="laboratory",
        code_display="Creatinine",
        value_numeric=168.0,
        value_text=None,
        unit="μmol/L",
        ref_range_low=59.0,
        ref_range_high=104.0,
        effective_at="2026-05-24T06:15:00+03:00",
        status="final",
    )


def _make_vital_obs() -> ObservationInput:
    return ObservationInput(
        id="obs-002",
        category="vital-signs",
        code_display="Heart Rate",
        value_numeric=88.0,
        value_text=None,
        unit="bpm",
        ref_range_low=None,
        ref_range_high=None,
        effective_at="2026-05-24T06:00:00+03:00",
        status="final",
    )


def _make_med() -> MedicationInput:
    return MedicationInput(
        id="med-001",
        medication_display="Metformin",
        dose="500 mg",
        route="PO",
        frequency="BID",
        status="active",
        started_at="2022-03-01",
        prescriber="Dr. Ahmed Al-Rashid",
    )


def _make_condition() -> ConditionInput:
    return ConditionInput(
        id="cond-001",
        code_display="Type 2 Diabetes Mellitus",
        code_system="ICD-10",
        code="E11.9",
        status="active",
        onset_date="2014",
    )


def _make_allergy() -> AllergyInput:
    return AllergyInput(
        id="allergy-001",
        code_display="Penicillin",
        reaction="rash",
        severity="mild",
        recorded_at="2019-04-15",
    )


def _make_encounter() -> EncounterInput:
    return EncounterInput(
        id="enc-001",
        encounter_type="inpatient",
        status="in-progress",
        started_at="2026-05-22T14:30:00+03:00",
        ended_at=None,
        ward="IM-3B",
        bed="12",
    )


def _make_document() -> DocumentInput:
    return DocumentInput(
        id="doc-001",
        doc_type="Progress Note",
        authored_at="2026-05-23T10:00:00+03:00",
        author="Dr. Nora Al-Ghamdi",
        content="Patient presented with community-acquired pneumonia. Vital signs stable.",
    )


# ── Both language variants ────────────────────────────────────────────────────

def test_both_language_variants_generated() -> None:
    data = PatientChunkInput(
        patient_id="patient-001",
        conditions=[_make_condition()],
    )
    chunks = chunk_patient_record(data)
    languages = {c.language for c in chunks}
    assert "en" in languages
    assert "ar" in languages


def test_ar_variant_has_suffix() -> None:
    data = PatientChunkInput(
        patient_id="patient-001",
        conditions=[_make_condition()],
    )
    chunks = chunk_patient_record(data)
    ar_chunks = [c for c in chunks if c.language == "ar"]
    for c in ar_chunks:
        assert c.content_text.endswith(" [AR]")


# ── Lab observation format ────────────────────────────────────────────────────

def test_lab_observation_chunk_format() -> None:
    data = PatientChunkInput(patient_id="patient-001", observations=[_make_lab_obs()])
    chunks = chunk_patient_record(data)
    en_chunks = [c for c in chunks if c.language == "en" and c.source_type == "Observation"]
    assert len(en_chunks) == 1
    text = en_chunks[0].content_text
    assert "Creatinine" in text
    assert "168.0" in text
    assert "μmol/L" in text
    assert "59.0-104.0" in text
    assert "Reference range" in text
    assert "Status: final" in text


def test_lab_observation_source_id() -> None:
    data = PatientChunkInput(patient_id="patient-001", observations=[_make_lab_obs()])
    chunks = chunk_patient_record(data)
    for c in chunks:
        assert c.source_id == "obs-001"
        assert c.source_type == "Observation"


# ── Vital signs format ────────────────────────────────────────────────────────

def test_vital_observation_chunk_format() -> None:
    data = PatientChunkInput(patient_id="patient-001", observations=[_make_vital_obs()])
    chunks = chunk_patient_record(data)
    en = next(c for c in chunks if c.language == "en")
    assert "Heart Rate" in en.content_text
    assert "88.0" in en.content_text
    assert "bpm" in en.content_text
    assert "Reference range" not in en.content_text


# ── MedicationRequest format ──────────────────────────────────────────────────

def test_medication_chunk_format() -> None:
    data = PatientChunkInput(patient_id="patient-001", medications=[_make_med()])
    chunks = chunk_patient_record(data)
    en = next(c for c in chunks if c.language == "en")
    assert "Metformin" in en.content_text
    assert "500 mg" in en.content_text
    assert "BID" in en.content_text
    assert "active" in en.content_text
    assert "Dr. Ahmed Al-Rashid" in en.content_text
    assert en.source_type == "MedicationRequest"


# ── Condition format ──────────────────────────────────────────────────────────

def test_condition_chunk_format() -> None:
    data = PatientChunkInput(patient_id="patient-001", conditions=[_make_condition()])
    chunks = chunk_patient_record(data)
    en = next(c for c in chunks if c.language == "en")
    assert "Type 2 Diabetes Mellitus" in en.content_text
    assert "ICD-10:E11.9" in en.content_text
    assert "active" in en.content_text
    assert "onset 2014" in en.content_text
    assert en.source_type == "Condition"


# ── Allergy format ────────────────────────────────────────────────────────────

def test_allergy_chunk_format() -> None:
    data = PatientChunkInput(patient_id="patient-001", allergies=[_make_allergy()])
    chunks = chunk_patient_record(data)
    en = next(c for c in chunks if c.language == "en")
    assert "Penicillin" in en.content_text
    assert "rash" in en.content_text
    assert "mild" in en.content_text
    assert en.source_type == "AllergyIntolerance"


# ── Document chunking with overlap ───────────────────────────────────────────

def test_short_document_single_chunk() -> None:
    data = PatientChunkInput(patient_id="patient-001", documents=[_make_document()])
    chunks = chunk_patient_record(data)
    doc_chunks = [c for c in chunks if c.source_type == "DocumentReference"]
    # short content → 1 EN + 1 AR
    assert len(doc_chunks) == 2


def test_long_document_multiple_chunks() -> None:
    long_content = "A" * 1200  # > 500 chars
    doc = DocumentInput(
        id="doc-long",
        doc_type="Discharge Summary",
        authored_at="2026-05-24",
        author="Dr. X",
        content=long_content,
    )
    data = PatientChunkInput(patient_id="patient-001", documents=[doc])
    chunks = chunk_patient_record(data)
    en_chunks = [c for c in chunks if c.language == "en" and c.source_type == "DocumentReference"]
    assert len(en_chunks) > 1
    # chunk indices are sequential
    indices = [c.chunk_index for c in en_chunks]
    assert indices == sorted(indices)


# ── Multi-resource ────────────────────────────────────────────────────────────

def test_full_record_chunk_count() -> None:
    data = PatientChunkInput(
        patient_id="patient-001",
        observations=[_make_lab_obs(), _make_vital_obs()],
        medications=[_make_med()],
        conditions=[_make_condition()],
        allergies=[_make_allergy()],
        encounters=[_make_encounter()],
        documents=[_make_document()],
    )
    chunks = chunk_patient_record(data)
    # 7 resources × 2 languages = 14 chunks minimum
    assert len(chunks) >= 14
