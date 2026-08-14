"""Unit tests for the ORCHESTRATOR_MODEL_PROVIDER switch.

Two things get verified: which provider `resolve_provider()` picks for a
given env, and that `format_agent_prose`/`generate_soap_note` actually call
through to the module `resolve_provider()` named -- not just that the env
parsing is right in isolation.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ORCHESTRATOR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ORCHESTRATOR_DIR))

import deepseek_client  # noqa: E402
import model_router  # noqa: E402
import scripted_model  # noqa: E402


# --------------------------------------------------------------------------
# resolve_provider
# --------------------------------------------------------------------------
def test_defaults_to_deepseek_when_key_is_present():
    assert model_router.resolve_provider({"DEEPSEEK_API_KEY": "sk-real"}) == "deepseek"


def test_falls_back_to_stub_when_key_is_absent_even_without_explicit_provider():
    # No ORCHESTRATOR_MODEL_PROVIDER set at all, no DEEPSEEK_API_KEY -- this is
    # the literal "DEEPSEEK_API_KEY unset -> scripted_model, no 500s" case.
    assert model_router.resolve_provider({}) == "stub"


def test_explicit_stub_wins_even_with_a_key_present():
    env = {"ORCHESTRATOR_MODEL_PROVIDER": "stub", "DEEPSEEK_API_KEY": "sk-real"}
    assert model_router.resolve_provider(env) == "stub"


def test_explicit_deepseek_without_a_key_still_falls_back_to_stub():
    env = {"ORCHESTRATOR_MODEL_PROVIDER": "deepseek"}
    assert model_router.resolve_provider(env) == "stub"


def test_provider_value_is_case_insensitive():
    env = {"ORCHESTRATOR_MODEL_PROVIDER": "STUB", "DEEPSEEK_API_KEY": "sk-real"}
    assert model_router.resolve_provider(env) == "stub"


def test_unrecognised_provider_value_falls_back_to_deepseek_default():
    env = {"ORCHESTRATOR_MODEL_PROVIDER": "something-else", "DEEPSEEK_API_KEY": "sk-real"}
    assert model_router.resolve_provider(env) == "deepseek"


def test_blank_key_counts_as_absent():
    env = {"DEEPSEEK_API_KEY": "   "}
    assert model_router.resolve_provider(env) == "stub"


# --------------------------------------------------------------------------
# format_agent_prose / generate_soap_note routing
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_stub_provider_routes_to_scripted_model(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "stub")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    called = {"scripted": False, "deepseek": False}

    async def fake_scripted(facts, agent_role, *, patient_id=None):
        called["scripted"] = True
        return "scripted prose"

    async def fake_deepseek(facts, agent_role, *, client=None):
        called["deepseek"] = True
        return "real prose"

    monkeypatch.setattr(scripted_model, "format_agent_prose", fake_scripted)
    monkeypatch.setattr(deepseek_client, "format_agent_prose", fake_deepseek)

    out = await model_router.format_agent_prose({"x": 1}, agent_role="Pharmacist")
    assert out == "scripted prose"
    assert called == {"scripted": True, "deepseek": False}


@pytest.mark.asyncio
async def test_deepseek_provider_with_key_routes_to_deepseek_client(monkeypatch):
    monkeypatch.delenv("ORCHESTRATOR_MODEL_PROVIDER", raising=False)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-real")

    called = {"scripted": False, "deepseek": False}

    async def fake_scripted(facts, agent_role, *, patient_id=None):
        called["scripted"] = True
        return "scripted prose"

    async def fake_deepseek(facts, agent_role, *, client=None):
        called["deepseek"] = True
        return "real prose"

    monkeypatch.setattr(scripted_model, "format_agent_prose", fake_scripted)
    monkeypatch.setattr(deepseek_client, "format_agent_prose", fake_deepseek)

    out = await model_router.format_agent_prose({"x": 1}, agent_role="Pharmacist")
    assert out == "real prose"
    assert called == {"scripted": False, "deepseek": True}


@pytest.mark.asyncio
async def test_missing_key_falls_back_to_scripted_model_with_no_exception(monkeypatch):
    # No ORCHESTRATOR_MODEL_PROVIDER, no DEEPSEEK_API_KEY -- the exact laptop
    # scenario the acceptance criteria names: must not raise/500.
    monkeypatch.delenv("ORCHESTRATOR_MODEL_PROVIDER", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    async def fail_if_called(*a, **k):
        raise AssertionError("deepseek_client must not be called when no key is configured")

    monkeypatch.setattr(deepseek_client, "format_agent_prose", fail_if_called)
    monkeypatch.setattr(deepseek_client, "generate_soap_note", fail_if_called)

    prose = await model_router.format_agent_prose({"x": 1}, agent_role="Consultant")
    soap = await model_router.generate_soap_note("Patient reports fatigue.")
    assert prose != ""
    assert soap["subjective"]


@pytest.mark.asyncio
async def test_generate_soap_note_stub_routing(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "stub")

    async def fail_if_called(*a, **k):
        raise AssertionError("deepseek_client must not be called in stub mode")

    monkeypatch.setattr(deepseek_client, "generate_soap_note", fail_if_called)

    soap = await model_router.generate_soap_note("Patient reports fatigue for two days.")
    assert soap["subjective"]


# --------------------------------------------------------------------------
# local provider -- resolve_provider
# --------------------------------------------------------------------------
def test_local_provider_resolves_when_explicit():
    env = {"ORCHESTRATOR_MODEL_PROVIDER": "local"}
    assert model_router.resolve_provider(env) == "local"


def test_local_provider_is_case_insensitive():
    env = {"ORCHESTRATOR_MODEL_PROVIDER": "LOCAL"}
    assert model_router.resolve_provider(env) == "local"


def test_local_provider_does_not_require_deepseek_key():
    # "local" should resolve even without a DEEPSEEK_API_KEY.
    env = {"ORCHESTRATOR_MODEL_PROVIDER": "local"}
    assert model_router.resolve_provider(env) == "local"


# --------------------------------------------------------------------------
# local provider -- format_agent_prose / generate_soap_note routing
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_local_provider_routes_format_agent_prose(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "local")
    monkeypatch.setenv("MODEL_ENDPOINT_URL", "http://localhost:11434")
    monkeypatch.setenv("MODEL_NAME", "test-model")

    from model_provider import LocalModelProvider  # noqa: E402

    async def fake_complete(self, system_prompt, user_prompt, params):
        assert "Consultant" in system_prompt
        assert "diagnosis" in user_prompt
        return "The patient has been diagnosed with Hypertension."

    monkeypatch.setattr(LocalModelProvider, "complete", fake_complete)

    out = await model_router.format_agent_prose(
        {"diagnosis": "Hypertension"}, agent_role="Consultant",
    )
    assert "Hypertension" in out


@pytest.mark.asyncio
async def test_local_provider_routes_generate_soap_note(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "local")
    monkeypatch.setenv("MODEL_ENDPOINT_URL", "http://localhost:11434")
    monkeypatch.setenv("MODEL_NAME", "test-model")

    from model_provider import LocalModelProvider  # noqa: E402

    async def fake_complete(self, system_prompt, user_prompt, params):
        assert "TRANSCRIPT:" in user_prompt
        return (
            '{"subjective": "Patient reports headache.", '
            '"objective": "BP 130/85.", '
            '"assessment": "As documented.", '
            '"plan": "Follow up in two weeks."}'
        )

    monkeypatch.setattr(LocalModelProvider, "complete", fake_complete)

    soap = await model_router.generate_soap_note("Patient reports headache. BP 130/85.")
    assert set(soap.keys()) == set(model_router.SOAP_FIELDS)
    assert "headache" in soap["subjective"]


@pytest.mark.asyncio
async def test_local_provider_empty_facts_returns_empty(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "local")
    monkeypatch.setenv("MODEL_ENDPOINT_URL", "http://localhost:11434")

    out = await model_router.format_agent_prose({}, agent_role="Consultant")
    assert out == ""


@pytest.mark.asyncio
async def test_local_provider_empty_transcript_returns_empty_soap(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "local")
    monkeypatch.setenv("MODEL_ENDPOINT_URL", "http://localhost:11434")

    soap = await model_router.generate_soap_note("   ")
    assert soap == {field: "" for field in model_router.SOAP_FIELDS}


@pytest.mark.asyncio
async def test_local_provider_does_not_call_deepseek(monkeypatch):
    """When ORCHESTRATOR_MODEL_PROVIDER=local, deepseek_client must not be invoked."""
    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "local")
    monkeypatch.setenv("MODEL_ENDPOINT_URL", "http://localhost:11434")

    from model_provider import LocalModelProvider  # noqa: E402

    call_count = 0

    async def fake_complete(self, system_prompt, user_prompt, params):
        nonlocal call_count
        call_count += 1
        # First call is format_agent_prose, second is generate_soap_note
        if call_count == 1:
            return "local prose"
        return '{"subjective": "Patient reports fatigue.", "objective": "", "assessment": "", "plan": ""}'

    monkeypatch.setattr(LocalModelProvider, "complete", fake_complete)

    async def fail_if_called(*a, **k):
        raise AssertionError("deepseek_client must not be called in local mode")

    monkeypatch.setattr(deepseek_client, "format_agent_prose", fail_if_called)
    monkeypatch.setattr(deepseek_client, "generate_soap_note", fail_if_called)

    prose = await model_router.format_agent_prose({"x": 1}, agent_role="Consultant")
    soap = await model_router.generate_soap_note("Patient reports fatigue.")
    assert prose == "local prose"
    assert set(soap.keys()) == set(model_router.SOAP_FIELDS)
    assert soap["subjective"] == "Patient reports fatigue."
