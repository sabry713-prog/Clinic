"""Tests for the narrative generation pipeline.

AC-4 exit gate:
  - Stub mode: generate_narrative returns text, not fallback
  - Stub mode: returned text passes blocklist
  - Stub mode: provenance is non-empty
  - Fallback path: when model always returns blocklisted text, fallback is returned
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.narrative.assembly import AssembledPatientData
from src.narrative.model_client import ModelParams, StubModelProvider
from src.narrative.narrative_service import generate_narrative, FALLBACK_MESSAGE
from blocklist import scan


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_assembled_data(patient_id: str = "patient-001") -> AssembledPatientData:
    return AssembledPatientData(
        patient_id=patient_id,
        patient_demographics_json='{"display_name": "Test Patient", "date_of_birth": "1958-01-01"}',
        current_encounter_json='{"encounter_type": "inpatient", "started_at": "2026-05-22"}',
        conditions_json='[{"id": "cond-1", "code_display": "Type 2 Diabetes", "code": "E11.9"}]',
        allergies_json='[{"id": "al-1", "code_display": "Penicillin", "reaction": "rash"}]',
        active_medications_json='[{"id": "med-1", "medication_display": "Metformin 500mg"}]',
        recent_observations_json='[{"id": "obs-1", "code_display": "Creatinine", "value_numeric": 168}]',
        recent_documents_json='[]',
        prior_admissions_json='[]',
        raw_demographics={"display_name": "Test Patient", "date_of_birth": "1958-01-01"},
        raw_conditions=[{"id": "cond-1", "code_display": "Type 2 Diabetes", "code": "E11.9"}],
        raw_allergies=[{"id": "al-1", "code_display": "Penicillin", "reaction": "rash"}],
        raw_medications=[{"id": "med-1", "medication_display": "Metformin 500mg"}],
        raw_observations=[{"id": "obs-1", "code_display": "Creatinine", "value_numeric": 168}],
        raw_documents=[],
        raw_encounters=[],
    )


async def _mock_assemble(patient_id: str, scope: str, pool: object) -> AssembledPatientData:
    return _make_assembled_data(patient_id)


# ── Stub mode tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stub_mode_returns_text_not_fallback() -> None:
    model = StubModelProvider()
    with patch("src.narrative.narrative_service.assemble_patient_data", new=_mock_assemble):
        output = await generate_narrative(
            patient_id="patient-001",
            language="en",
            scope="full",
            pool=MagicMock(),
            model=model,
        )
    assert output.text is not None
    assert output.text != ""
    assert output.fallback_message is None


@pytest.mark.asyncio
async def test_stub_mode_text_passes_blocklist() -> None:
    model = StubModelProvider()
    with patch("src.narrative.narrative_service.assemble_patient_data", new=_mock_assemble):
        output = await generate_narrative(
            patient_id="patient-001",
            language="en",
            scope="full",
            pool=MagicMock(),
            model=model,
        )
    assert output.text is not None
    result = scan(output.text, language="en")
    assert result.passed, f"Stub output failed blocklist: {result.matches}"


@pytest.mark.asyncio
async def test_stub_mode_provenance_non_empty() -> None:
    model = StubModelProvider()
    with patch("src.narrative.narrative_service.assemble_patient_data", new=_mock_assemble):
        output = await generate_narrative(
            patient_id="patient-001",
            language="en",
            scope="full",
            pool=MagicMock(),
            model=model,
        )
    assert output.provenance is not None
    assert len(output.provenance) > 0


@pytest.mark.asyncio
async def test_stub_mode_metadata_populated() -> None:
    model = StubModelProvider()
    with patch("src.narrative.narrative_service.assemble_patient_data", new=_mock_assemble):
        output = await generate_narrative(
            patient_id="patient-001",
            language="en",
            scope="full",
            pool=MagicMock(),
            model=model,
        )
    assert output.model_version == "stub-v1"
    assert output.prompt_template_version == "v1.0"
    assert output.language == "en"
    assert output.scope == "full"
    assert output.patient_id == "patient-001"
    assert output.narrative_id != ""
    assert output.generated_at != ""


# ── Fallback path tests ───────────────────────────────────────────────────────

class AlwaysBlocklistedModel:
    """Always returns text that triggers the blocklist."""

    def version(self) -> str:
        return "always-blocked-v1"

    async def complete(self, system_prompt: str, user_prompt: str, params: ModelParams) -> str:
        return "This suggests worsening renal function and the patient is at risk of AKI."


@pytest.mark.asyncio
async def test_fallback_returned_after_max_retries() -> None:
    model = AlwaysBlocklistedModel()
    with patch("src.narrative.narrative_service.assemble_patient_data", new=_mock_assemble):
        output = await generate_narrative(
            patient_id="patient-001",
            language="en",
            scope="full",
            pool=MagicMock(),
            model=model,
        )
    assert output.text is None
    assert output.fallback_message == FALLBACK_MESSAGE
    assert output.blocklist_triggered is True
    assert output.blocklist_retries >= 2


@pytest.mark.asyncio
async def test_fallback_provenance_empty() -> None:
    model = AlwaysBlocklistedModel()
    with patch("src.narrative.narrative_service.assemble_patient_data", new=_mock_assemble):
        output = await generate_narrative(
            patient_id="patient-001",
            language="en",
            scope="full",
            pool=MagicMock(),
            model=model,
        )
    assert output.provenance == []


# ── Language variants ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_arabic_scope_respected_in_output() -> None:
    model = StubModelProvider()
    with patch("src.narrative.narrative_service.assemble_patient_data", new=_mock_assemble):
        output = await generate_narrative(
            patient_id="patient-001",
            language="ar",
            scope="current_encounter",
            pool=MagicMock(),
            model=model,
        )
    assert output.language == "ar"
    assert output.scope == "current_encounter"
