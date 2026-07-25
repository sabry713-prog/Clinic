"""Integration tests for inter-agent message routing (Sprint 10).

The load-bearing assertions are the grounding ones. It is easy to write a bus
that passes messages; the thing worth proving is that nothing invents a clinical
fact along the way:

  - the chain only starts when NSCRE reports a critical finding,
  - evidence chains survive every hop byte-for-byte (object equality, not a
    similarity judgement -- same invariant as test_agent_handlers.py),
  - alternatives come from the graph endpoint, never from the model,
  - an unmappable coverage check reports `unknown` rather than "covered",
  - a failing hop surfaces an error event instead of silently truncating.

Network is mocked throughout; DeepSeek is patched so no prose call is made.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agent_bus  # noqa: E402
from agent_bus import (  # noqa: E402
    EVENT_ALTERNATIVES_SCREENED,
    EVENT_CONSULTANT_ESCALATION,
    EVENT_COVERAGE_VERIFIED,
    EVENT_CRITICAL_FINDING,
    EVENT_PLAN_UPDATED,
    AgentBus,
    AgentEvent,
    build_default_bus,
    detect_critical_findings,
    run_critical_finding_chain,
)

DOSE_CHAIN = {
    "steps": [
        {"node_type": "Patient", "properties": {"id": "pat-1"}},
        {"node_type": "LabResult", "properties": {"test": "eGFR", "value": 22.05}},
        {"node_type": "Medication", "properties": {"name": "Metformin"}},
        {"node_type": "Rule", "properties": {"flag": "CRITICAL_OVERRIDE"}},
    ],
    "rendered": "Patient(id=pat-1) -> LabResult(test=eGFR, value=22.05) -> Medication(name=Metformin) -> Rule(flag=CRITICAL_OVERRIDE)",
}

CANDIDATE_CHAIN = {
    "steps": [
        {"node_type": "Patient", "properties": {"id": "pat-1"}},
        {"node_type": "CandidateMedication", "properties": {"name": "Lisinopril"}},
    ],
    "rendered": "Patient(id=pat-1) -> CandidateMedication(name=Lisinopril)",
}

CRITICAL_EVALUATION = {
    "patient_id": "pat-1",
    "drug_interactions": [],
    "dose_safety": [
        {
            "medication": "Metformin",
            "flag": "CRITICAL_OVERRIDE",
            "rationale": "Contraindicated below eGFR 30.",
            "evidence_chain": DOSE_CHAIN,
        }
    ],
    "necessity": [],
}

QUIET_EVALUATION = {
    "patient_id": "pat-1",
    "drug_interactions": [],
    "dose_safety": [],
    "necessity": [],
}

ALTERNATIVES_RESPONSE = {
    "screened_candidates": [
        {
            "medication": "Lisinopril",
            "medication_key": "lisinopril",
            "screen_result": "no_contraindication_found",
            "evidence_chain": CANDIDATE_CHAIN,
        }
    ],
    "rejected_candidates": [
        {"medication": "Ibuprofen", "reason": "contraindicated_with_current_medication"}
    ],
    "disclaimer": "not a therapeutic substitution recommendation",
}


def _handler(*, evaluation=CRITICAL_EVALUATION, necessity=None, fail_alternatives=False):
    """Mock NSCRE. `necessity=None` mimics a candidate with no matching rule."""

    def handle(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/evaluate-encounter"):
            return httpx.Response(200, json=evaluation)
        if path.endswith("/alternative-candidates"):
            if fail_alternatives:
                return httpx.Response(500, json={"detail": "graph down"})
            return httpx.Response(200, json=ALTERNATIVES_RESPONSE)
        if path.endswith("/check-order"):
            return httpx.Response(200, json={"necessity": necessity})
        return httpx.Response(404, json={})

    return handle


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def _no_deepseek(monkeypatch):
    """Scribe prose is not under test here; assert on plan_facts instead."""
    async def fake_prose(facts, agent_role, **kwargs):
        return f"[{agent_role} prose]"

    monkeypatch.setattr(agent_bus, "format_agent_prose", fake_prose)


def _by_type(events: list[dict]) -> dict[str, dict]:
    return {e["event_type"]: e for e in events}


# ---------------------------------------------------------------- detection
def test_critical_dose_finding_is_detected():
    findings = detect_critical_findings(CRITICAL_EVALUATION)
    assert len(findings) == 1
    assert findings[0]["kind"] == "dose_safety"


def test_severe_interaction_is_detected():
    findings = detect_critical_findings(
        {
            "drug_interactions": [
                {"drug_a": "Warfarin", "drug_b": "Ibuprofen", "severity": "severe", "evidence_chain": DOSE_CHAIN}
            ],
            "dose_safety": [],
        }
    )
    assert findings[0]["kind"] == "drug_interaction"


def test_non_critical_findings_are_not_escalated():
    """Only flags NSCRE itself set may trigger a chain."""
    findings = detect_critical_findings(
        {
            "drug_interactions": [{"drug_a": "A", "drug_b": "B", "severity": "moderate"}],
            "dose_safety": [{"medication": "X", "flag": "ADVISORY"}],
        }
    )
    assert findings == []


# ---------------------------------------------------------------- full chain
async def test_full_chain_routes_through_all_four_agents():
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    types = [e["event_type"] for e in events]
    assert types == [
        EVENT_CRITICAL_FINDING,
        EVENT_CONSULTANT_ESCALATION,
        EVENT_ALTERNATIVES_SCREENED,
        EVENT_COVERAGE_VERIFIED,
        EVENT_PLAN_UPDATED,
    ]


async def test_handoff_targets_follow_the_specified_flow():
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    hops = [(e["source_agent"], e["target_agent"]) for e in events]
    assert hops == [
        ("nscre", "consultant"),
        ("consultant", "pharmacist"),
        ("pharmacist", "nphies"),
        ("nphies", "scribe"),
        ("scribe", "clinician"),
    ]


async def test_all_hops_share_one_correlation_id():
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()
    assert len({e["correlation_id"] for e in events}) == 1


async def test_no_critical_finding_starts_no_chain():
    client = _client(_handler(evaluation=QUIET_EVALUATION))
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()
    assert events == []


# ---------------------------------------------------------------- grounding
async def test_evidence_chain_survives_every_hop_unmodified():
    """The single most important assertion in this file: what the graph
    produced is what the clinician eventually sees."""
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    by_type = _by_type(events)
    assert by_type[EVENT_CRITICAL_FINDING]["payload"]["evidence_chain"] == DOSE_CHAIN
    assert by_type[EVENT_CONSULTANT_ESCALATION]["payload"]["evidence_chain"] == DOSE_CHAIN
    assert by_type[EVENT_PLAN_UPDATED]["payload"]["evidence_chain"] == DOSE_CHAIN


async def test_alternatives_come_from_the_graph_endpoint_verbatim():
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    payload = _by_type(events)[EVENT_ALTERNATIVES_SCREENED]["payload"]
    assert payload["screened_candidates"] == ALTERNATIVES_RESPONSE["screened_candidates"]
    assert payload["rejected_candidates"] == ALTERNATIVES_RESPONSE["rejected_candidates"]


async def test_candidates_are_labelled_as_screened_not_recommended():
    """Wording boundary: passing screening is not a substitution recommendation."""
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    payload = _by_type(events)[EVENT_ALTERNATIVES_SCREENED]["payload"]
    assert "screened_candidates" in payload
    assert "recommended_alternatives" not in payload
    assert payload["screened_candidates"][0]["screen_result"] == "no_contraindication_found"


async def test_unmappable_coverage_reports_unknown_not_covered():
    """A candidate with no matching necessity rule must never read as covered."""
    client = _client(_handler(necessity=None))
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    coverage = _by_type(events)[EVENT_COVERAGE_VERIFIED]["payload"]["coverage"]
    assert coverage[0]["status"] == "unknown"


async def test_coverage_passes_through_a_real_necessity_verdict():
    client = _client(_handler(necessity={"status": "GREEN", "pre_auth_required": False}))
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    coverage = _by_type(events)[EVENT_COVERAGE_VERIFIED]["payload"]["coverage"]
    assert coverage[0]["status"] == "GREEN"
    assert coverage[0]["pre_auth_required"] is False


async def test_scribe_plan_facts_match_the_graph_not_the_model():
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    plan = _by_type(events)[EVENT_PLAN_UPDATED]["payload"]
    assert plan["plan_facts"]["flagged_medication"] == "Metformin"
    assert plan["plan_facts"]["screened_candidates"] == ["Lisinopril"]


async def test_scribe_draft_is_never_auto_applied():
    """Human-in-the-loop: the agent drafts, the clinician commits."""
    client = _client(_handler())
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()
    assert _by_type(events)[EVENT_PLAN_UPDATED]["payload"]["applied"] is False


# ---------------------------------------------------------------- resilience
async def test_failing_hop_emits_an_error_event_rather_than_truncating():
    client = _client(_handler(fail_alternatives=True))
    try:
        events = await run_critical_finding_chain("pat-1", client=client)
    finally:
        await client.aclose()

    types = [e["event_type"] for e in events]
    assert f"{EVENT_CONSULTANT_ESCALATION}.failed" in types
    # The chain stops, but visibly -- never silently.
    assert EVENT_PLAN_UPDATED not in types


async def test_bus_bounds_runaway_chains():
    """A handler that re-emits its own trigger must not loop forever."""
    bus = AgentBus(max_hops=5)

    async def loop_handler(_bus, event):
        return AgentEvent(
            event_type="loop",
            patient_id=event.patient_id,
            source_agent="a",
            target_agent="b",
        )

    bus.on("loop", loop_handler)
    events = await bus.publish(
        AgentEvent(event_type="loop", patient_id="pat-1", source_agent="a", target_agent="b")
    )
    assert len(events) <= 5


# ---------------------------------------------------------------- UI fan-out
async def test_subscribers_receive_every_handoff_for_the_activity_stream():
    client = _client(_handler())
    bus = build_default_bus(client)
    queue = bus.subscribe()
    try:
        await run_critical_finding_chain("pat-1", client=client, bus=bus)
    finally:
        await client.aclose()

    received = []
    while not queue.empty():
        received.append(queue.get_nowait())

    assert len(received) == 5
    assert all(e["event"] == "agent_handoff" for e in received)
    assert [e["sequence"] for e in received] == [0, 1, 2, 3, 4]


async def test_unsubscribe_stops_delivery():
    bus = AgentBus()
    queue = bus.subscribe()
    bus.unsubscribe(queue)
    await bus.publish(
        AgentEvent(event_type="x", patient_id="p", source_agent="a", target_agent="b")
    )
    assert queue.empty()
