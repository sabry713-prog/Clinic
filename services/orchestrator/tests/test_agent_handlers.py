"""Tests for the tethered AI Team agent handlers (Sprint 8).

Mirrors tests/test_deepseek.py's "patch the network boundary" style: both
`fetch_nscre_evaluation` (the NSCRE HTTP call) and `deepseek_client.format_agent_prose`
(the DeepSeek HTTP call) are monkeypatched, so these tests never hit a real
network. The central assertion throughout: every `evidence_chain` an agent
returns is object-equal to the one in the mocked NSCRE payload -- the task's
own "no hallucinated additions" requirement, checked deterministically.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ORCHESTRATOR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ORCHESTRATOR_DIR))

import agent_handlers  # noqa: E402
from agent_handlers import (  # noqa: E402
    STATUS_BADGES,
    app,
    consultant_agent,
    nphies_agent,
    pharmacist_agent,
)

INTERACTION_CHAIN = {
    "steps": [
        {"node_type": "Patient", "properties": {"id": "patient-1"}},
        {"node_type": "Medication", "properties": {"name": "Warfarin"}},
        {"node_type": "Medication", "properties": {"name": "Ibuprofen"}},
        {"node_type": "Contraindication", "properties": {"severity": "severe"}},
    ],
    "rendered": "Patient(id=patient-1) -> Medication(name=Warfarin) -> Medication(name=Ibuprofen) -> Contraindication(severity=severe)",
}

DOSE_CHAIN = {
    "steps": [
        {"node_type": "Patient", "properties": {"id": "patient-1"}},
        {"node_type": "LabResult", "properties": {"value": 28.0}},
        {"node_type": "Medication", "properties": {"name": "Metformin"}},
        {"node_type": "Rule", "properties": {"flag": "CRITICAL_OVERRIDE"}},
    ],
    "rendered": "Patient(id=patient-1) -> LabResult(value=28.0) -> Medication(name=Metformin) -> Rule(flag=CRITICAL_OVERRIDE)",
}

NECESSITY_CHAIN = {
    "steps": [
        {"node_type": "Patient", "properties": {"id": "patient-1"}},
        {"node_type": "Medication", "properties": {"name": "Metformin", "sfda_code": "SFDA-A10BA02"}},
        {"node_type": "Condition", "properties": {"icd10": "I10"}},
        {"node_type": "NecessityRule", "properties": {"status": "GREEN"}},
    ],
    "rendered": "Patient(id=patient-1) -> Medication(name=Metformin) -> Condition(icd10=I10) -> NecessityRule(status=GREEN)",
}

FULL_EVALUATION = {
    "patient_id": "patient-1",
    "drug_interactions": [
        {
            "drug_a": "Warfarin",
            "drug_b": "Ibuprofen",
            "severity": "severe",
            "rationale": "Bleeding risk",
            "evidence_chain": INTERACTION_CHAIN,
        }
    ],
    "dose_safety": [
        {
            "medication": "Metformin",
            "egfr_value": 28.0,
            "flag": "CRITICAL_OVERRIDE",
            "evidence_chain": DOSE_CHAIN,
        }
    ],
    "necessity": [
        {
            "medication": "Metformin",
            "status": "GREEN",
            "pre_auth_required": False,
            "suggested_codes": [],
            "evidence_chain": NECESSITY_CHAIN,
        }
    ],
}

EMPTY_EVALUATION = {"patient_id": "patient-1", "drug_interactions": [], "dose_safety": [], "necessity": []}


@pytest.fixture
def mock_nscre(monkeypatch):
    """Patches the NSCRE network boundary. Returns a mutable holder so tests
    can swap the response and inspect call args."""
    calls = []

    async def fake_fetch(patient_id, *, client=None):
        calls.append(patient_id)
        return fake_fetch.response

    fake_fetch.response = FULL_EVALUATION
    fake_fetch.calls = calls
    monkeypatch.setattr(agent_handlers, "fetch_nscre_evaluation", fake_fetch)
    return fake_fetch


@pytest.fixture
def mock_deepseek(monkeypatch):
    """Patches the DeepSeek network boundary. Records every call's role+facts."""
    calls = []

    async def fake_format(facts, agent_role, **kwargs):
        calls.append({"facts": facts, "agent_role": agent_role})
        return f"Formatted prose for {agent_role}."

    fake_format.calls = calls
    monkeypatch.setattr(agent_handlers, "format_agent_prose", fake_format)
    return fake_format


# -- Pharmacist -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_pharmacist_evidence_chains_match_nscre_exactly(mock_nscre, mock_deepseek):
    result = await pharmacist_agent("patient-1")
    assert result["evidence_chains"] == [INTERACTION_CHAIN, DOSE_CHAIN]
    assert result["findings"]["drug_interactions"] == FULL_EVALUATION["drug_interactions"]
    assert result["findings"]["dose_safety"] == FULL_EVALUATION["dose_safety"]


@pytest.mark.asyncio
async def test_pharmacist_calls_deepseek_with_raw_nscre_facts(mock_nscre, mock_deepseek):
    await pharmacist_agent("patient-1")
    assert len(mock_deepseek.calls) == 1
    call = mock_deepseek.calls[0]
    assert call["agent_role"] == "Pharmacist"
    assert call["facts"]["drug_interactions"] == FULL_EVALUATION["drug_interactions"]
    assert call["facts"]["dose_safety"] == FULL_EVALUATION["dose_safety"]


@pytest.mark.asyncio
async def test_pharmacist_empty_findings_skips_deepseek(mock_nscre, mock_deepseek):
    mock_nscre.response = EMPTY_EVALUATION
    result = await pharmacist_agent("patient-1")
    assert result["prose"] == ""
    assert result["evidence_chains"] == []
    assert mock_deepseek.calls == []


# -- Consultant -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_consultant_evidence_chains_match_nscre_exactly(mock_nscre, mock_deepseek):
    result = await consultant_agent("patient-1")
    assert result["evidence_chains"] == [INTERACTION_CHAIN, DOSE_CHAIN, NECESSITY_CHAIN]


@pytest.mark.asyncio
async def test_consultant_calls_deepseek_with_all_three_fact_categories(mock_nscre, mock_deepseek):
    await consultant_agent("patient-1")
    call = mock_deepseek.calls[0]
    assert call["agent_role"] == "Consultant"
    assert set(call["facts"].keys()) == {"drug_interactions", "dose_safety", "necessity"}
    assert call["facts"]["necessity"] == FULL_EVALUATION["necessity"]


@pytest.mark.asyncio
async def test_consultant_empty_findings_skips_deepseek(mock_nscre, mock_deepseek):
    mock_nscre.response = EMPTY_EVALUATION
    result = await consultant_agent("patient-1")
    assert result["prose"] == ""
    assert mock_deepseek.calls == []


# -- NPHIES -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_nphies_agent_builds_card_with_correct_badge(mock_nscre, mock_deepseek):
    result = await nphies_agent("patient-1")
    assert len(result["cards"]) == 1
    card = result["cards"][0]
    assert card["status"] == "GREEN"
    assert card["badge"] == STATUS_BADGES["GREEN"]
    assert card["evidence_chain"] == NECESSITY_CHAIN


@pytest.mark.asyncio
async def test_nphies_agent_evidence_chains_match_nscre_exactly(mock_nscre, mock_deepseek):
    result = await nphies_agent("patient-1")
    assert result["evidence_chains"] == [NECESSITY_CHAIN]


@pytest.mark.asyncio
async def test_nphies_agent_empty_necessity_skips_deepseek(mock_nscre, mock_deepseek):
    mock_nscre.response = EMPTY_EVALUATION
    result = await nphies_agent("patient-1")
    assert result["cards"] == []
    assert mock_deepseek.calls == []


@pytest.mark.parametrize(
    ("status", "badge"),
    [("GREEN", "\U0001f7e2"), ("YELLOW", "\U0001f7e1"), ("RED", "\U0001f534")],
)
@pytest.mark.asyncio
async def test_nphies_badge_mapping(mock_nscre, mock_deepseek, status, badge):
    mock_nscre.response = {
        **EMPTY_EVALUATION,
        "necessity": [{"medication": "X", "status": status, "pre_auth_required": True, "evidence_chain": None}],
    }
    result = await nphies_agent("patient-1")
    assert result["cards"][0]["badge"] == badge


# -- SSE stream ---------------------------------------------------------------------


def test_agent_stream_emits_three_updates_and_a_done_event(monkeypatch):
    async def fake_fetch(patient_id, *, client=None):
        return FULL_EVALUATION

    async def fake_format(facts, agent_role, **kwargs):
        return f"Formatted {agent_role}."

    monkeypatch.setattr(agent_handlers, "fetch_nscre_evaluation", fake_fetch)
    monkeypatch.setattr(agent_handlers, "format_agent_prose", fake_format)

    client = TestClient(app)
    with client.stream("GET", "/api/v1/agents/stream", params={"patient_id": "patient-1"}) as resp:
        body = "".join(resp.iter_text())

    assert body.count("event: agent_update") == 3
    assert body.count("event: done") == 1
    assert '"agent": "pharmacist"' in body
    assert '"agent": "consultant"' in body
    assert '"agent": "nphies"' in body


def test_health_endpoint():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
