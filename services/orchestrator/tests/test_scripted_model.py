"""Unit tests for the scripted_model fallback (ORCHESTRATOR_MODEL_PROVIDER=stub).

Never calls a network boundary -- there isn't one to patch. These tests
verify the two contracts that matter for a fallback: (1) same input/output
shape as deepseek_client, and (2) it never states a clinical fact that
wasn't already present in its input.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ORCHESTRATOR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ORCHESTRATOR_DIR))

from scripted_model import SOAP_FIELDS, format_agent_prose, generate_soap_note  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
TRANSCRIPTS_PATH = REPO_ROOT / "apps" / "core" / "src" / "seed" / "fixtures" / "consultation-transcripts.jsonl"


def _load_demo_transcripts() -> list[dict]:
    with TRANSCRIPTS_PATH.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


# --------------------------------------------------------------------------
# format_agent_prose
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_empty_facts_returns_empty():
    assert await format_agent_prose({}, agent_role="Scribe") == ""


@pytest.mark.asyncio
async def test_non_empty_facts_never_returns_empty():
    out = await format_agent_prose({"coverage_status": "active"}, agent_role="NPHIES")
    assert out != ""


@pytest.mark.asyncio
async def test_facts_with_only_falsy_values_still_returns_non_empty():
    out = await format_agent_prose({"drug_interactions": [], "dose_safety": None}, agent_role="Pharmacist")
    assert out != ""


@pytest.mark.asyncio
async def test_prose_states_only_facts_it_was_given():
    facts = {"flagged_medication": "Metformin", "screened_candidates": ["Sitagliptin"]}
    out = await format_agent_prose(facts, agent_role="Pharmacist")
    assert "Metformin" in out
    assert "Sitagliptin" in out
    # Never introduces a drug name that wasn't in the input.
    assert "Warfarin" not in out


@pytest.mark.asyncio
async def test_agent_role_appears_in_output():
    out = await format_agent_prose({"necessity": ["x"]}, agent_role="Consultant")
    assert "Consultant" in out


@pytest.mark.asyncio
async def test_known_mrn_uses_patient_colour():
    out = await format_agent_prose({"diagnosis": "Hypertension"}, agent_role="Consultant", patient_id="MRN-006")
    assert "Omar" in out
    assert "MRN-006" in out


@pytest.mark.asyncio
async def test_unknown_patient_id_falls_back_to_generic_colour_without_error():
    out = await format_agent_prose({"diagnosis": "Hypertension"}, agent_role="Consultant", patient_id="not-an-mrn-uuid")
    assert out != ""


@pytest.mark.asyncio
async def test_no_patient_id_falls_back_to_generic_colour():
    out = await format_agent_prose({"diagnosis": "Hypertension"}, agent_role="Consultant")
    assert out != ""


# --------------------------------------------------------------------------
# generate_soap_note
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_empty_transcript_returns_all_four_fields_empty():
    soap = await generate_soap_note("   ")
    assert soap == {field: "" for field in SOAP_FIELDS}


@pytest.mark.asyncio
async def test_non_empty_transcript_returns_all_four_keys():
    soap = await generate_soap_note("Patient reports a headache for three days.")
    assert set(soap.keys()) == set(SOAP_FIELDS)


@pytest.mark.asyncio
async def test_every_line_is_preserved_verbatim_somewhere():
    transcript = (
        "Patient reports a headache for three days.\n"
        "BP 130/85, HR 78.\n"
        "Known history of migraine.\n"
        "Let's get a follow-up in two weeks."
    )
    soap = await generate_soap_note(transcript)
    joined = " ".join(soap.values())
    for line in transcript.splitlines():
        assert line.strip() in joined


@pytest.mark.asyncio
async def test_objective_cue_routes_to_objective():
    soap = await generate_soap_note("BP 130/85 recorded at triage.")
    assert "BP 130/85" in soap["objective"]
    assert "BP 130/85" not in soap["subjective"]


@pytest.mark.asyncio
async def test_plan_cue_routes_to_plan():
    soap = await generate_soap_note("Let's get a follow-up scheduled in two weeks.")
    assert "follow-up" in soap["plan"]


@pytest.mark.asyncio
async def test_unmatched_line_defaults_to_subjective():
    soap = await generate_soap_note("Patient feels generally well today.")
    assert "Patient feels generally well today." in soap["subjective"]


# --------------------------------------------------------------------------
# demo consultation transcripts (apps/core/src/seed/fixtures) -- real EN/AR/
# code-switched dictation content, not synthetic one-liners, so this checks
# the fallback against the same fixtures the scribe demo actually uses.
# --------------------------------------------------------------------------
def test_demo_transcripts_cover_five_patients_and_three_languages():
    records = _load_demo_transcripts()
    assert len(records) == 15
    assert {r["mrn"] for r in records} == {"MRN-006", "MRN-007", "MRN-008", "MRN-009", "MRN-010"}
    assert {r["language"] for r in records} == {"en", "ar", "ar-en"}


@pytest.mark.asyncio
async def test_soap_note_is_never_empty_for_any_demo_transcript():
    for record in _load_demo_transcripts():
        soap = await generate_soap_note(record["transcript"], patient_id=record["mrn"])
        assert set(soap.keys()) == set(SOAP_FIELDS)
        # At least one section must carry the dictation -- never all-blank
        # for real, non-empty clinical content.
        assert any(soap.values())


@pytest.mark.asyncio
async def test_soap_note_preserves_demo_transcript_verbatim():
    # Every fixture is a single dictated line, so it lands whole in exactly
    # one SOAP bucket -- the fallback reshuffles lines, it never rewrites or
    # summarizes them, in Arabic, English, or code-switched text alike.
    for record in _load_demo_transcripts():
        soap = await generate_soap_note(record["transcript"], patient_id=record["mrn"])
        assert "".join(soap.values()) == record["transcript"]
