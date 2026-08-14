"""ModelProvider Protocol and concrete providers for the orchestrator.

Ports the abstraction from apps/qa's model_client.py so the orchestrator's
LLM calls are swappable via ``ORCHESTRATOR_MODEL_PROVIDER=stub|local|deepseek``.

Every provider that targets a non-local endpoint routes through
``phi_guard.guard_outbound()`` (CLAUDE.md §7 / PDPL) before making the
HTTP call.

The orchestrator's stub path continues to route through ``scripted_model``
(per-agent prose + SOAP bucketing), so the ``StubModelProvider`` here is
intentionally minimal — it exists so ``get_model()`` always returns a
Protocol-conformant object.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx
import structlog

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------

@dataclass
class ModelParams:
    """Tuning knobs forwarded to the model endpoint."""
    temperature: float = 0.0
    top_p: float = 1.0
    max_tokens: int = 1024
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0


@runtime_checkable
class ModelProvider(Protocol):
    """Minimal contract every model backend must satisfy."""

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str: ...

    def version(self) -> str: ...


# ---------------------------------------------------------------------------
# Stub
# ---------------------------------------------------------------------------

class StubModelProvider:
    """Deterministic no-network fallback.

    ``complete()`` returns a canned placeholder.  The orchestrator's real
    stub path (``model_router`` → ``scripted_model``) has per-agent prose
    and SOAP-bucketing logic that is far richer than a generic stub could
    provide, so routing goes through ``model_router`` rather than through
    this class directly.
    """

    def version(self) -> str:  # noqa: D401
        return "stub-orchestrator-v1"

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        return "[stub]"


# ---------------------------------------------------------------------------
# Local (OpenAI-compatible endpoint with phi-guard)
# ---------------------------------------------------------------------------

class LocalModelProvider:
    """OpenAI-compatible ``/chat/completions`` endpoint with phi-guard
    enforcement.

    Every outbound call passes through ``phi_guard.guard_outbound()``.
    In-Kingdom endpoints are pass-through; external endpoints are governed
    by ``PHI_EGRESS_POLICY`` (default: *block*).
    """

    def __init__(
        self,
        endpoint_url: str,
        model_name: str,
        api_key: str = "EMPTY",
        timeout_s: float = 30.0,
        patient_names: list[str] | None = None,
    ) -> None:
        self._url = endpoint_url.rstrip("/") + "/chat/completions"
        self._model = model_name
        self._api_key = api_key
        self._timeout = timeout_s
        self._patient_names = patient_names or []

    def version(self) -> str:  # noqa: D401
        return f"local:{self._model}"

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        # DATA-RESIDENCY GATE (CLAUDE.md §7 / PDPL).
        from phi_guard import guard_outbound  # type: ignore[import-untyped]

        decision = guard_outbound(
            endpoint_url=self._url,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            contains_phi=True,
            patient_names=self._patient_names,
        )
        if decision.redaction_count:
            logger.info(
                "phi_deidentified_before_egress",
                redactions=decision.redaction_count,
                residency=decision.residency.value,
            )

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": decision.system_prompt},
                {"role": "user", "content": decision.user_prompt},
            ],
            "temperature": params.temperature,
            "top_p": params.top_p,
            "max_tokens": params.max_tokens,
            "frequency_penalty": params.frequency_penalty,
            "presence_penalty": params.presence_penalty,
            "stream": False,
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(self._url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        raw = str(data["choices"][0]["message"]["content"]).strip()
        return decision.restore(raw)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_model(patient_names: list[str] | None = None) -> ModelProvider:
    """Return a :class:`ModelProvider` from environment settings.

    Reads ``ORCHESTRATOR_MODEL_PROVIDER`` and the standard endpoint vars
    (``MODEL_ENDPOINT_URL``, ``MODEL_NAME``, ``MODEL_API_KEY``,
    ``MODEL_TIMEOUT_S``).
    """
    provider = (
        os.environ.get("ORCHESTRATOR_MODEL_PROVIDER", "deepseek")
        .strip()
        .lower()
    )
    if provider == "local":
        endpoint_url = os.environ.get("MODEL_ENDPOINT_URL", "http://localhost:11434")
        model_name = os.environ.get("MODEL_NAME", "dummy")
        api_key = os.environ.get("MODEL_API_KEY", "EMPTY")
        timeout_s = float(os.environ.get("MODEL_TIMEOUT_S", "30"))
        return LocalModelProvider(
            endpoint_url=endpoint_url,
            model_name=model_name,
            api_key=api_key,
            timeout_s=timeout_s,
            patient_names=patient_names,
        )
    return StubModelProvider()
