"""Tests for live SOAP structuring, the Smart Checklist, and PHI egress.

The DeepSeek network boundary is patched throughout — no test calls
api.deepseek.com.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ORCHESTRATOR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ORCHESTRATOR_DIR))

import deepseek_client  # noqa: E402
import live_scribe  # noqa: E402
from live_scribe import (  # noqa: E402
    SYMPTOM_CHECKS,
    LiveScribeSession,
    checklist_for_transcript,
    stream_soap_updates,
    structure_transcript,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
MOCK_AUDIO = REPO_ROOT / "data" / "mock_audio"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.delenv("PHI_EGRESS_POLICY", raising=False)


def _fake_soap(**over):
    base = {"subjective": "S", "objective": "O", "assessment": "A", "plan": "P"}
    base.update(over)
    return json.dumps(base)


# ---------------------------------------------------------------- checklist
def test_checklist_triggers_on_spoken_symptom():
    items = checklist_for_transcript("Patient reports chest pain on exertion.")
    assert items
    assert all(i["symptom"] == "chest pain" for i in items)
    assert any("onset" in i["label"].lower() for i in items)


def test_checklist_is_case_insensitive():
    assert checklist_for_transcript("CHEST PAIN") == checklist_for_transcript("chest pain")


def test_checklist_handles_multiple_symptoms():
    items = checklist_for_transcript("fever for three days with a cough")
    symptoms = {i["symptom"] for i in items}
    assert symptoms == {"fever", "cough"}


def test_checklist_empty_when_no_symptom_mentioned():
    assert checklist_for_transcript("Good morning, please take a seat.") == []
    assert checklist_for_transcript("") == []


def test_checklist_does_not_duplicate_labels():
    items = checklist_for_transcript("chest pain ... more chest pain ... chest pain again")
    labels = [i["label"] for i in items]
    assert len(labels) == len(set(labels))


def test_checklist_is_deterministic_not_model_generated():
    """Every emitted label must come from the static table — CLAUDE.md
    Principle 1 forbids the model inventing clinical guidance."""
    known = {label for labels in SYMPTOM_CHECKS.values() for label in labels}
    for item in checklist_for_transcript("chest pain fever cough headache"):
        assert item["label"] in known


# ---------------------------------------------------------------- structuring
@pytest.mark.asyncio
async def test_structure_returns_soap_and_changed_fields(monkeypatch):
    async def fake_chat(*a, **k):
        return _fake_soap()

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    session = LiveScribeSession(session_id="s1")
    session.add_chunk("Patient reports chest pain.")

    result = await structure_transcript(session)
    assert result["soap"]["subjective"] == "S"
    assert set(result["changed"]) == {"subjective", "objective", "assessment", "plan"}


@pytest.mark.asyncio
async def test_only_changed_sections_are_reported(monkeypatch):
    async def fake_chat(*a, **k):
        return _fake_soap()

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    session = LiveScribeSession(session_id="s1")
    session.add_chunk("chest pain")
    await structure_transcript(session)          # first pass fills everything
    second = await structure_transcript(session)  # identical output
    assert second["changed"] == []                # nothing flashes a second time


# ---------------------------------------------------------------- SSE stream
async def _chunks(*texts):
    for t in texts:
        yield t


def _parse_sse(frames: list[str]) -> list[tuple[str, dict]]:
    out = []
    for frame in frames:
        lines = frame.strip().split("\n")
        event = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        out.append((event, data))
    return out


@pytest.mark.asyncio
async def test_stream_emits_transcript_soap_and_done(monkeypatch):
    async def fake_chat(*a, **k):
        return _fake_soap()

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    session = LiveScribeSession(session_id="s1")

    frames = [f async for f in stream_soap_updates(
        session, _chunks("Patient has chest pain.", "Blood pressure 148 over 92."),
    )]
    events = _parse_sse(frames)
    kinds = [e for e, _ in events]

    assert kinds.count("transcript") == 2
    assert "soap" in kinds
    assert "checklist" in kinds          # chest pain triggered it
    assert kinds[-1] == "done"


@pytest.mark.asyncio
async def test_stream_survives_a_model_failure(monkeypatch):
    """Losing the structuring step must not lose the clinician's words."""
    async def failing(*a, **k):
        raise deepseek_client.DeepSeekError("model exploded")

    monkeypatch.setattr(deepseek_client, "_chat_completion", failing)
    session = LiveScribeSession(session_id="s1")

    frames = [f async for f in stream_soap_updates(session, _chunks("chest pain", "more detail"))]
    events = _parse_sse(frames)
    kinds = [e for e, _ in events]

    assert "error" in kinds
    assert kinds.count("transcript") == 2   # transcript still delivered
    assert kinds[-1] == "done"
    assert session.transcript == "chest pain more detail"


# ---------------------------------------------------------------- PHI egress
@pytest.mark.asyncio
async def test_transcript_to_external_endpoint_is_blocked_by_default(monkeypatch):
    """Default policy must stop a consultation transcript reaching DeepSeek."""
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    sent = {}

    class FakeResponse:
        def raise_for_status(self): ...
        def json(self): return {"choices": [{"message": {"content": _fake_soap()}}]}

    class FakeClient:
        async def post(self, url, **kw):
            sent["called"] = True
            return FakeResponse()
        async def aclose(self): ...

    session = LiveScribeSession(session_id="s1")
    session.add_chunk("Patient Ahmad Al-Bishi, MRN-010, reports chest pain.")

    from phi_guard import PhiEgressBlocked
    with pytest.raises(PhiEgressBlocked):
        await structure_transcript(session, client=FakeClient())
    assert "called" not in sent  # refused before any network I/O


@pytest.mark.asyncio
async def test_deidentify_policy_scrubs_transcript_before_sending(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    monkeypatch.setenv("PHI_EGRESS_POLICY", "deidentify")
    captured = {}

    class FakeResponse:
        def raise_for_status(self): ...
        def json(self): return {"choices": [{"message": {"content": _fake_soap()}}]}

    class FakeClient:
        async def post(self, url, **kw):
            captured["user"] = kw["json"]["messages"][1]["content"]
            return FakeResponse()
        async def aclose(self): ...

    session = LiveScribeSession(session_id="s1", patient_names=["Ahmad Al-Bishi"])
    session.add_chunk("Patient Ahmad Al-Bishi, MRN-010, DOB 1962-08-25, reports chest pain.")

    await structure_transcript(session, client=FakeClient())
    sent = captured["user"]
    assert "Ahmad Al-Bishi" not in sent
    assert "MRN-010" not in sent
    assert "1962-08-25" not in sent
    assert "chest pain" in sent          # clinical content preserved


@pytest.mark.asyncio
async def test_in_kingdom_endpoint_sends_transcript_unmodified(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "http://127.0.0.1:1234")
    captured = {}

    class FakeResponse:
        def raise_for_status(self): ...
        def json(self): return {"choices": [{"message": {"content": _fake_soap()}}]}

    class FakeClient:
        async def post(self, url, **kw):
            captured["user"] = kw["json"]["messages"][1]["content"]
            return FakeResponse()
        async def aclose(self): ...

    session = LiveScribeSession(session_id="s1", patient_names=["Ahmad Al-Bishi"])
    session.add_chunk("Patient Ahmad Al-Bishi reports chest pain.")

    await structure_transcript(session, client=FakeClient())
    assert "Ahmad Al-Bishi" in captured["user"]   # on-prem: nothing stripped


# ---------------------------------------------------------------- fixtures
def test_mock_audio_fixtures_are_valid_and_trigger_their_symptoms():
    files = sorted(MOCK_AUDIO.glob("*.transcript.json"))
    assert len(files) >= 3

    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["synthetic"] is True
        assert data["chunks"], f"{path.name} has no chunks"

        transcript = " ".join(c["text"] for c in data["chunks"])
        found = {i["symptom"] for i in checklist_for_transcript(transcript)}
        for expected in data.get("expected_symptoms", []):
            assert expected in found, f"{path.name}: '{expected}' not detected"


def test_fixture_chunks_are_time_ordered():
    for path in MOCK_AUDIO.glob("*.transcript.json"):
        offsets = [c["at_ms"] for c in json.loads(path.read_text(encoding="utf-8"))["chunks"]]
        assert offsets == sorted(offsets), f"{path.name} chunks out of order"
