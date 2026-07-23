"""Unit tests for the DeepSeek client.

The network boundary (`_chat_completion`) is patched, so these tests never
call api.deepseek.com. They validate that synthetic ambient transcripts are
formatted into a well-formed SOAP structure and that the formatting-only
contract (no invented fields, all four SOAP keys present) holds.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Make `import deepseek_client` work regardless of pytest's rootdir.
ORCHESTRATOR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ORCHESTRATOR_DIR))

import deepseek_client  # noqa: E402
from deepseek_client import (  # noqa: E402
    SOAP_FIELDS,
    DeepSeekError,
    _extract_json_object,
    format_agent_prose,
    generate_soap_note,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_PATH = REPO_ROOT / "data" / "synthetic_seed.json"


def _load_encounters() -> list[dict]:
    with SEED_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)["encounters"]


def _fake_soap_json(transcript: str) -> str:
    """A canned DeepSeek response: a JSON SOAP object derived only from the
    transcript, mimicking a well-behaved formatter.
    """
    return json.dumps(
        {
            "subjective": transcript.split(".")[0].strip(),
            "objective": "Vitals and examination as documented.",
            "assessment": "As documented in the transcript.",
            "plan": "As documented in the transcript.",
        }
    )


@pytest.fixture(autouse=True)
def _api_key_env(monkeypatch):
    # Ensure the key check never blocks tests; the network call is patched anyway.
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")


# --------------------------------------------------------------------------
# generate_soap_note
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_soap_has_all_four_fields_for_every_synthetic_encounter(monkeypatch):
    async def fake_chat(system_prompt, user_prompt, **kwargs):
        # The transcript is embedded in the user prompt after "TRANSCRIPT:".
        transcript = user_prompt.split("TRANSCRIPT:", 1)[1].strip()
        return _fake_soap_json(transcript)

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)

    encounters = _load_encounters()
    assert len(encounters) == 10  # sanity: the seed pipeline has 10 encounters

    for enc in encounters:
        soap = await generate_soap_note(enc["ambient_transcript"])
        # Exactly the four SOAP keys, all strings.
        assert set(soap.keys()) == set(SOAP_FIELDS)
        assert all(isinstance(v, str) for v in soap.values())
        # Subjective is grounded in the transcript's opening statement.
        assert soap["subjective"]
        assert soap["subjective"].lower() in enc["ambient_transcript"].lower()


@pytest.mark.asyncio
async def test_soap_parses_fenced_json(monkeypatch):
    async def fake_chat(system_prompt, user_prompt, **kwargs):
        return (
            "```json\n"
            + json.dumps(
                {
                    "subjective": "S",
                    "objective": "O",
                    "assessment": "A",
                    "plan": "P",
                }
            )
            + "\n```"
        )

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    soap = await generate_soap_note("some transcript text.")
    assert soap == {"subjective": "S", "objective": "O", "assessment": "A", "plan": "P"}


@pytest.mark.asyncio
async def test_soap_fills_missing_keys_with_empty_string(monkeypatch):
    async def fake_chat(system_prompt, user_prompt, **kwargs):
        # Model returns only two of the four fields.
        return json.dumps({"subjective": "only subjective", "plan": "only plan"})

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    soap = await generate_soap_note("text.")
    assert soap["subjective"] == "only subjective"
    assert soap["plan"] == "only plan"
    assert soap["objective"] == ""
    assert soap["assessment"] == ""


@pytest.mark.asyncio
async def test_empty_transcript_short_circuits_without_api_call(monkeypatch):
    called = {"n": 0}

    async def fake_chat(*a, **k):
        called["n"] += 1
        return "{}"

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    soap = await generate_soap_note("   ")
    assert soap == {field: "" for field in SOAP_FIELDS}
    assert called["n"] == 0  # no network call for empty input


@pytest.mark.asyncio
async def test_soap_raises_on_non_json_response(monkeypatch):
    async def fake_chat(*a, **k):
        return "I could not format this."

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    with pytest.raises(DeepSeekError):
        await generate_soap_note("text.")


# --------------------------------------------------------------------------
# format_agent_prose
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_agent_prose_passes_role_and_facts(monkeypatch):
    seen = {}

    async def fake_chat(system_prompt, user_prompt, **kwargs):
        seen["system"] = system_prompt
        seen["user"] = user_prompt
        return "Coverage is active and the claim is ready."

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    facts = {"coverage_status": "active", "nphies_status": "green"}
    out = await format_agent_prose(facts, agent_role="NPHIES")
    assert out == "Coverage is active and the claim is ready."
    assert "NPHIES" in seen["system"]
    assert "coverage_status" in seen["user"]  # facts are handed to the model verbatim


@pytest.mark.asyncio
async def test_agent_prose_empty_facts_returns_empty(monkeypatch):
    async def fake_chat(*a, **k):
        raise AssertionError("should not be called for empty facts")

    monkeypatch.setattr(deepseek_client, "_chat_completion", fake_chat)
    assert await format_agent_prose({}, agent_role="Scribe") == ""


# --------------------------------------------------------------------------
# helpers / config
# --------------------------------------------------------------------------
def test_extract_json_object_tolerates_prose_wrapper():
    obj = _extract_json_object('Here you go: {"subjective": "x"} — done.')
    assert obj == {"subjective": "x"}


@pytest.mark.asyncio
async def test_missing_api_key_raises(monkeypatch):
    # Point at an in-Kingdom endpoint so the PHI egress guard passes through
    # and we actually reach the API-key check (the guard runs first and would
    # otherwise block an external URL before the key is ever read).
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "http://127.0.0.1:1234")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(DeepSeekError):
        await deepseek_client._chat_completion("sys", "user")


@pytest.mark.asyncio
async def test_guard_blocks_external_endpoint_before_api_key_is_read(monkeypatch):
    """Egress policy is evaluated ahead of everything else, so a missing key
    can never be the reason PHI does or does not leave."""
    from phi_guard import PhiEgressBlocked

    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(PhiEgressBlocked):
        await deepseek_client._chat_completion("sys", "patient record text")
