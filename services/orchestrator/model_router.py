"""ORCHESTRATOR_MODEL_PROVIDER switch -- the one place that decides whether an
AI Team agent's prose comes from real DeepSeek (``deepseek_client.py``,
untouched by this task) or the deterministic fallback (``scripted_model.py``),
or an on-prem OpenAI-compatible endpoint (``model_provider.py``).

Every caller in this service (``agent_bus.py``, ``agent_handlers.py``,
``receptionist_agent.py``) imports ``format_agent_prose`` / ``generate_soap_note``
from HERE, not from ``deepseek_client`` directly, so the switch is centralized
in one narrowly-scoped module rather than five separate if/else blocks.

Three ways into the stub path, two deliberate and one automatic:

  1. Explicit ``ORCHESTRATOR_MODEL_PROVIDER=stub``.  Always uses
     ``scripted_model``, regardless of whether a DeepSeek key is configured.
  2. Explicit ``ORCHESTRATOR_MODEL_PROVIDER=local``.  Uses a
     ``LocalModelProvider`` pointed at the ``MODEL_ENDPOINT_URL`` with
     ``phi_guard`` enforcement (CLAUDE.md §7 / PDPL).
  3. Automatic fallback: ``ORCHESTRATOR_MODEL_PROVIDER`` left at its default
     (``"deepseek"``) but ``DEEPSEEK_API_KEY`` is unset.  A demo laptop that
     never configured a key must not 500 on every AI Team action -- this is the
     concrete mechanism behind the task's "DEEPSEEK_API_KEY unset -> system
     still runs using ``scripted_model.py``, no 500s" acceptance criterion.
     Each fallback is logged (``model_router_fallback_to_stub``) so it stays
     visible rather than silently masking a misconfigured key in a real
     deployment.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

import httpx
import structlog

sys.path.insert(0, str(Path(__file__).resolve().parent))

import deepseek_client  # noqa: E402
import scripted_model  # noqa: E402

logger = structlog.get_logger()

SOAP_FIELDS = deepseek_client.SOAP_FIELDS

_STUB = "stub"
_DEEPSEEK = "deepseek"
_LOCAL = "local"


def _configured_provider(env: Optional[dict[str, str]] = None) -> str:
    source = env if env is not None else os.environ
    raw = (source.get("ORCHESTRATOR_MODEL_PROVIDER") or _DEEPSEEK).strip().lower()
    return raw if raw in (_STUB, _DEEPSEEK, _LOCAL) else _DEEPSEEK


def _has_deepseek_key(env: Optional[dict[str, str]] = None) -> bool:
    source = env if env is not None else os.environ
    return bool((source.get("DEEPSEEK_API_KEY") or "").strip())


def resolve_provider(env: Optional[dict[str, str]] = None) -> str:
    """Which provider actually runs for the next call: ``"stub"``, ``"local"``,
    or ``"deepseek"``.

    Pure given ``env``; defaults to the real process environment.  Exposed
    (not just used internally) so callers/tests can ask which path is about
    to be taken without triggering a call.
    """
    configured = _configured_provider(env)
    if configured == _STUB:
        return _STUB
    if configured == _LOCAL:
        return _LOCAL
    if not _has_deepseek_key(env):
        logger.warning(
            "model_router_fallback_to_stub",
            reason="DEEPSEEK_API_KEY unset",
            configured_provider=configured,
        )
        return _STUB
    return _DEEPSEEK


# ---------------------------------------------------------------------------
# Local-provider helpers -- construct prompts matching deepseek_client's
# structure and delegate to model_provider.LocalModelProvider.complete().
# ---------------------------------------------------------------------------

async def _format_via_local(
    facts: dict[str, Any],
    agent_role: str,
    *,
    patient_id: Optional[str] = None,
) -> str:
    """``format_agent_prose`` through ``LocalModelProvider``."""
    from model_provider import ModelParams, get_model  # noqa: E402

    if not facts:
        return ""

    provider = get_model(
        patient_names=[patient_id] if patient_id else None,
    )

    system_prompt = deepseek_client._AGENT_SYSTEM_PROMPT.format(
        agent_role=agent_role,
    )
    user_prompt = (
        f"AGENT ROLE: {agent_role}\n"
        f"FACTS (JSON, retrieved from the knowledge graph):\n"
        f"{json.dumps(facts, ensure_ascii=False, indent=2)}\n\n"
        "Rephrase ONLY these facts into a short conversational message."
    )
    raw = await provider.complete(
        system_prompt,
        user_prompt,
        ModelParams(temperature=0.2),
    )
    return raw.strip()


async def _soap_via_local(
    transcript: str,
    *,
    patient_id: Optional[str] = None,
) -> dict[str, str]:
    """``generate_soap_note`` through ``LocalModelProvider``."""
    from model_provider import ModelParams, get_model  # noqa: E402

    if not transcript or not transcript.strip():
        return {field: "" for field in SOAP_FIELDS}

    provider = get_model(
        patient_names=[patient_id] if patient_id else None,
    )

    raw = await provider.complete(
        deepseek_client._SOAP_SYSTEM_PROMPT,
        f"TRANSCRIPT:\n{transcript.strip()}",
        ModelParams(temperature=0.0),
    )
    obj = deepseek_client._extract_json_object(raw)
    return {field: str(obj.get(field, "") or "").strip() for field in SOAP_FIELDS}


# ---------------------------------------------------------------------------
# Public routing surface
# ---------------------------------------------------------------------------

async def format_agent_prose(
    facts: dict[str, Any],
    agent_role: str,
    *,
    patient_id: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> str:
    """Routes to scripted_model, LocalModelProvider, or deepseek_client.

    Same contract as all three: empty ``facts`` -> ``""``, non-empty
    ``facts`` -> non-empty text.
    """
    provider = resolve_provider()
    if provider == _STUB:
        return await scripted_model.format_agent_prose(
            facts, agent_role, patient_id=patient_id,
        )
    if provider == _LOCAL:
        return await _format_via_local(
            facts, agent_role, patient_id=patient_id,
        )
    return await deepseek_client.format_agent_prose(
        facts, agent_role, client=client,
    )


async def generate_soap_note(
    transcript: str,
    *,
    patient_id: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> dict[str, str]:
    """Routes to scripted_model, LocalModelProvider, or deepseek_client.

    Same contract as all three: blank transcript -> all four SOAP fields
    empty.
    """
    provider = resolve_provider()
    if provider == _STUB:
        return await scripted_model.generate_soap_note(
            transcript, patient_id=patient_id,
        )
    if provider == _LOCAL:
        return await _soap_via_local(transcript, patient_id=patient_id)
    return await deepseek_client.generate_soap_note(transcript, client=client)
