"""Tests for provenance verification."""
from __future__ import annotations

import pytest

from src.narrative.assembly import AssembledPatientData
from src.narrative.provenance import verify_provenance, _sentences


def _make_data() -> AssembledPatientData:
    return AssembledPatientData(
        patient_id="patient-001",
        patient_demographics_json="{}",
        current_encounter_json="{}",
        conditions_json="[]",
        allergies_json="[]",
        active_medications_json="[]",
        recent_observations_json="[]",
        recent_documents_json="[]",
        prior_admissions_json="[]",
        raw_demographics={"display_name": "Abdullah Al-Test", "date_of_birth": "1958-01-01"},
        raw_conditions=[{"id": "cond-1", "code_display": "Type 2 Diabetes", "code": "E11.9", "onset_date": "2014"}],
        raw_allergies=[{"id": "al-1", "code_display": "Penicillin", "reaction": "rash"}],
        raw_medications=[{"id": "med-1", "medication_display": "Metformin", "dose": "500mg"}],
        raw_observations=[{"id": "obs-1", "code_display": "Creatinine", "value_numeric": 168, "effective_at": "2026-05-24"}],
        raw_documents=[],
        raw_encounters=[],
    )


def test_sentences_split() -> None:
    text = "First sentence. Second sentence. Third sentence."
    parts = _sentences(text)
    assert len(parts) == 3


def test_sentences_preserves_char_ranges() -> None:
    text = "Hello world. Goodbye world."
    parts = _sentences(text)
    for start, end, sentence in parts:
        assert text[start:end].strip().startswith(sentence[:5])


def test_verify_provenance_returns_entry_per_sentence() -> None:
    data = _make_data()
    text = "The patient has a documented condition of Type 2 Diabetes. Creatinine was 168 on 2026-05-24."
    entries = verify_provenance(text, data)
    assert len(entries) == 2


def test_verify_provenance_condition_match() -> None:
    data = _make_data()
    text = "Type 2 Diabetes is a documented condition."
    entries = verify_provenance(text, data)
    assert len(entries) >= 1
    all_sources = [s for e in entries for s in e.sources]
    types = {s["type"] for s in all_sources}
    assert "Condition" in types


def test_verify_provenance_medication_match() -> None:
    data = _make_data()
    text = "Active medication: Metformin 500mg."
    entries = verify_provenance(text, data)
    all_sources = [s for e in entries for s in e.sources]
    types = {s["type"] for s in all_sources}
    assert "MedicationRequest" in types


def test_verify_provenance_observation_match() -> None:
    data = _make_data()
    text = "Creatinine 168 recorded on 2026-05-24."
    entries = verify_provenance(text, data)
    all_sources = [s for e in entries for s in e.sources]
    types = {s["type"] for s in all_sources}
    assert "Observation" in types


def test_verify_provenance_demographics_match() -> None:
    data = _make_data()
    text = "Abdullah Al-Test is the documented patient."
    entries = verify_provenance(text, data)
    all_sources = [s for e in entries for s in e.sources]
    types = {s["type"] for s in all_sources}
    assert "Patient" in types


def test_verify_provenance_empty_text() -> None:
    data = _make_data()
    entries = verify_provenance("", data)
    assert entries == []


def test_verify_provenance_no_duplicate_sources() -> None:
    data = _make_data()
    text = "Creatinine 168 on 2026-05-24 Creatinine."
    entries = verify_provenance(text, data)
    for entry in entries:
        ids = [(s["type"], s["id"]) for s in entry.sources]
        assert len(ids) == len(set(ids)), "Duplicate sources in provenance entry"
