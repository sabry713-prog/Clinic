"""Tests for prompt template filling."""
from __future__ import annotations

import pytest

from src.narrative.assembly import AssembledPatientData
from src.narrative.prompt import fill_prompt, PROMPT_TEMPLATE_VERSION


def _make_full_data() -> AssembledPatientData:
    return AssembledPatientData(
        patient_id="patient-001",
        patient_demographics_json='{"display_name": "Abdullah Al-Test", "date_of_birth": "1958-01-01"}',
        current_encounter_json='{"encounter_type": "inpatient", "started_at": "2026-05-22"}',
        conditions_json='[{"code_display": "Type 2 Diabetes", "code": "E11.9"}]',
        allergies_json='[{"code_display": "Penicillin", "reaction": "rash"}]',
        active_medications_json='[{"medication_display": "Metformin 500mg"}]',
        recent_observations_json='[{"code_display": "Creatinine", "value_numeric": 168, "unit": "umol/L"}]',
        recent_documents_json='[{"type": "Progress Note", "author": "Dr. X", "authored_at": "2026-05-23"}]',
        prior_admissions_json='[{"started_at": "2025-02-11", "admitting_diagnosis_display": "AKI"}]',
    )


def _make_empty_data() -> AssembledPatientData:
    return AssembledPatientData(
        patient_id="patient-002",
        patient_demographics_json="{}",
        current_encounter_json="{}",
        conditions_json="[]",
        allergies_json="[]",
        active_medications_json="[]",
        recent_observations_json="[]",
        recent_documents_json="[]",
        prior_admissions_json="[]",
    )


def test_fill_prompt_returns_tuple() -> None:
    system, user = fill_prompt(_make_full_data(), "en", "full")
    assert isinstance(system, str)
    assert isinstance(user, str)


def test_fill_prompt_language_in_system() -> None:
    system, _ = fill_prompt(_make_full_data(), "en", "full")
    assert "en" in system


def test_fill_prompt_language_ar_in_system() -> None:
    system, _ = fill_prompt(_make_full_data(), "ar", "full")
    assert "ar" in system


def test_fill_prompt_scope_in_user() -> None:
    _, user = fill_prompt(_make_full_data(), "en", "current_encounter")
    assert "current_encounter" in user


def test_fill_prompt_demographics_in_user() -> None:
    _, user = fill_prompt(_make_full_data(), "en", "full")
    assert "Abdullah Al-Test" in user


def test_fill_prompt_conditions_in_user() -> None:
    _, user = fill_prompt(_make_full_data(), "en", "full")
    assert "Type 2 Diabetes" in user


def test_fill_prompt_medications_in_user() -> None:
    _, user = fill_prompt(_make_full_data(), "en", "full")
    assert "Metformin 500mg" in user


def test_fill_prompt_observations_in_user() -> None:
    _, user = fill_prompt(_make_full_data(), "en", "full")
    assert "Creatinine" in user


def test_fill_prompt_empty_fields_show_empty_json() -> None:
    """Empty fields should show [] or {} rather than Python None."""
    _, user = fill_prompt(_make_empty_data(), "en", "full")
    assert "[]" in user or "{}" in user


def test_fill_prompt_no_unfilled_placeholders() -> None:
    """No {placeholder} should remain in the filled prompts."""
    import re
    system, user = fill_prompt(_make_full_data(), "en", "full")
    # Find any remaining {word} placeholders that were not filled
    unfilled = re.findall(r"\{[a-z_]+\}", system + user)
    assert unfilled == [], f"Unfilled placeholders: {unfilled}"


def test_prompt_template_version() -> None:
    assert PROMPT_TEMPLATE_VERSION == "v1.1"


def test_fill_prompt_sections_present() -> None:
    _, user = fill_prompt(_make_full_data(), "en", "full")
    assert "DOCUMENTED PROBLEMS" in user
    assert "DOCUMENTED ALLERGIES" in user
    assert "ACTIVE MEDICATIONS" in user
    assert "RECENT OBSERVATIONS" in user
