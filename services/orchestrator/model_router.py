"""ORCHESTRATOR_MODEL_PROVIDER switch -- the one place that decides whether an
AI Team agent's prose comes from real DeepSeek (`deepseek_client.py`,
untouched by this task) or the deterministic fallback (`scripted_model.py`).

Every caller in this service (`agent_bus.py`, `agent_handlers.py`,
`receptionist_agent.py`) imports `format_agent_prose` / `generate_soap_note`
from HERE, not from `deepseek_client` directly, so the switch is centralized
in one narrowly-scoped module rather than five separate if/else blocks.

Two ways into the stub path, both deliberate:

  1. Explicit: ORCHESTRATOR_MODEL_PROVIDER=stub. Always uses scripted_model,
     regardless of whether a DeepSeek key is configured.
  2. Automatic fallback: ORCHESTRATOR_MODEL_PROVIDER left at its default
     ("deepseek") but DEEPSEEK_API_KEY is unset. A demo laptop that never
     configured a key must not 500 on every AI Team action -- this is the
     concrete mechanism behind the task's "DEEPSEEK_API_KEY unset -> system
     still runs using scripted_model.py, no 500s" acceptance criterion. Each
     fallback is logged (`model_router_fallback_to_stub`) so it stays visible
     rather than silently masking a misconfigured key in a real deployment.

This is scoped to laptop-demo resilience for services/orchestrator's five
existing call sites -- not the full self-hosted ModelProvider Protocol swap
tracked as E2 in docs/ENGINEERING_WORK_BREAKDOWN.md (that also covers
apps/qa / apps/narrative and PHI-guard wiring, which this does not touch).
"""
from __future__ import annotations

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


def _configured_provider(env: Optional[dict[str, str]] = None) -> str:
    source = env if env is not None else os.environ
    raw = (source.get("ORCHESTRATOR_MODEL_PROVIDER") or _DEEPSEEK).strip().lower()
    return raw if raw in (_STUB, _DEEPSEEK) else _DEEPSEEK


def _has_deepseek_key(env: Optional[dict[str, str]] = None) -> bool:
    source = env if env is not None else os.environ
    return bool((source.get("DEEPSEEK_API_KEY") or "").strip())


def resolve_provider(env: Optional[dict[str, str]] = None) -> str:
    """Which provider actually runs for the next call: "stub" or "deepseek".

    Pure given `env`; defaults to the real process environment. Exposed
    (not just used internally) so callers/tests can ask which path is about
    to be taken without triggering a call.
    """
    configured = _configured_provider(env)
    if configured == _STUB:
        return _STUB
    if not _has_deepseek_key(env):
        logger.warning(
            "model_router_fallback_to_stub",
            reason="DEEPSEEK_API_KEY unset",
            configured_provider=configured,
        )
        return _STUB
    return _DEEPSEEK


async def format_agent_prose(
    facts: dict[str, Any],
    agent_role: str,
    *,
    patient_id: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> str:
    """Routes to scripted_model or deepseek_client. Same contract as both:
    empty `facts` -> "", non-empty `facts` -> non-empty text."""
    if resolve_provider() == _STUB:
        return await scripted_model.format_agent_prose(facts, agent_role, patient_id=patient_id)
    return await deepseek_client.format_agent_prose(facts, agent_role, client=client)


async def generate_soap_note(
    transcript: str,
    *,
    patient_id: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> dict[str, str]:
    """Routes to scripted_model or deepseek_client. Same contract as both:
    blank transcript -> all four SOAP fields empty."""
    if resolve_provider() == _STUB:
        return await scripted_model.generate_soap_note(transcript, patient_id=patient_id)
    return await deepseek_client.generate_soap_note(transcript, client=client)
