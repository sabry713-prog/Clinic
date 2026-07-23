"""DeepSeek API client for the Veritas-Medica orchestrator.

Scope (CLAUDE.md, Core Principles 1 & 2): the DeepSeek API is used ONLY for
natural-language formatting — structuring ambient transcripts into SOAP notes
and turning already-retrieved graph facts into readable prose. It MUST NOT be
used to guess or generate clinical facts, drug dosages, or NPHIES billing
codes; those come deterministically from Neo4j. Every prompt here therefore
instructs the model to reshape the supplied text only and never to invent,
infer, or add clinical content.

Configuration comes from the environment:
    DEEPSEEK_API_KEY   (required)  API key for api.deepseek.com
    DEEPSEEK_BASE_URL  (optional)  default https://api.deepseek.com
    DEEPSEEK_MODEL     (optional)  default deepseek-chat
    DEEPSEEK_TIMEOUT_S (optional)  default 60
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import httpx

from phi_guard import PhiEgressBlocked, guard_outbound

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"
DEFAULT_TIMEOUT_S = 60.0

SOAP_FIELDS = ("subjective", "objective", "assessment", "plan")

# System prompts pin the model to formatting-only behaviour so it can never
# become a source of clinical facts (CLAUDE.md Principle 1).
_SOAP_SYSTEM_PROMPT = (
    "You are a medical scribe formatter. You are given a raw ambient "
    "consultation transcript. Reorganise its EXISTING content into a SOAP "
    "note. Do NOT add, infer, diagnose, or invent any clinical fact, "
    "measurement, medication, or dosage that is not literally present in the "
    "transcript. If a SOAP section has no supporting content in the "
    "transcript, return an empty string for it. "
    'Respond ONLY with a JSON object with exactly these keys: '
    '"subjective", "objective", "assessment", "plan".'
)

_AGENT_SYSTEM_PROMPT = (
    "You are the '{agent_role}' agent in a clinician-facing assistant. You are "
    "given a set of structured facts that were already retrieved "
    "deterministically from the knowledge graph. Rephrase ONLY those facts "
    "into a short, clear, conversational message for the clinician. Do NOT "
    "add, infer, or invent any fact, value, recommendation, or code beyond "
    "what is given. Preserve every clinical term, value, and code verbatim."
)


class DeepSeekError(RuntimeError):
    """Raised when the DeepSeek API call or response is unusable."""


def _api_key() -> str:
    # DEEPSEEK_API_KEY is the module's own name; MODEL_API_KEY is the shared
    # one the rest of the services already use for the same endpoint.
    key = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("MODEL_API_KEY")
    if not key:
        raise DeepSeekError(
            "No API key configured. Set DEEPSEEK_API_KEY (or the shared "
            "MODEL_API_KEY) before calling the DeepSeek client."
        )
    return key


async def _chat_completion(
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.0,
    response_format: Optional[dict[str, str]] = None,
    client: Optional[httpx.AsyncClient] = None,
    contains_phi: bool = True,
    patient_names: Optional[list[str]] = None,
) -> str:
    """POST to DeepSeek's OpenAI-compatible /chat/completions and return the
    assistant message content. This is the single network boundary and the
    seam that tests patch.
    """
    base_url = (
        os.environ.get("DEEPSEEK_BASE_URL")
        or os.environ.get("MODEL_ENDPOINT_URL")
        or DEFAULT_BASE_URL
    ).rstrip("/")
    model = (
        os.environ.get("DEEPSEEK_MODEL")
        or os.environ.get("MODEL_NAME")
        or DEFAULT_MODEL
    )
    timeout = float(os.environ.get("DEEPSEEK_TIMEOUT_S", DEFAULT_TIMEOUT_S))

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "stream": False,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    # PHI residency gate (packages/phi-guard). A consultation transcript and
    # retrieved graph facts are PHI; api.deepseek.com is outside the Kingdom.
    # Policy decides: block (default), de-identify, or acknowledged allow.
    decision = guard_outbound(
        endpoint_url=base_url,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        contains_phi=contains_phi,
        patient_names=patient_names or [],
    )
    if decision.redaction_count:
        # Observability parity with the qa service. Counts only — never values.
        logger.info(
            "phi_deidentified_before_egress",
            extra={
                "redactions": decision.redaction_count,
                "residency": decision.residency.value,
            },
        )

    payload["messages"] = [
        {"role": "system", "content": decision.system_prompt},
        {"role": "user", "content": decision.user_prompt},
    ]

    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=timeout)
    try:
        resp = await client.post(
            f"{base_url}/chat/completions", json=payload, headers=headers
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:  # network / status errors
        raise DeepSeekError(f"DeepSeek request failed: {exc}") from exc
    finally:
        if owns_client:
            await client.aclose()

    try:
        raw = str(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise DeepSeekError(f"Unexpected DeepSeek response shape: {data!r}") from exc
    # Put real identifiers back before the clinician sees the text.
    return decision.restore(raw)


def _extract_json_object(text: str) -> dict[str, Any]:
    """Parse a JSON object out of a model response, tolerating ```json fences
    and surrounding prose.
    """
    stripped = text.strip()
    # Strip a ```json ... ``` or ``` ... ``` fence if present.
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", stripped, re.DOTALL)
    if fence:
        stripped = fence.group(1).strip()
    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError:
        # Last resort: grab the first {...} block.
        brace = re.search(r"\{.*\}", stripped, re.DOTALL)
        if not brace:
            raise DeepSeekError(f"Response is not JSON: {text!r}")
        obj = json.loads(brace.group(0))
    if not isinstance(obj, dict):
        raise DeepSeekError(f"Expected a JSON object, got {type(obj).__name__}")
    return obj


async def generate_soap_note(
    transcript: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    patient_names: Optional[list[str]] = None,
) -> dict[str, str]:
    """Structure an ambient consultation transcript into a SOAP note.

    Returns a dict with exactly the keys subjective, objective, assessment,
    plan (all strings). Formatting only — no clinical fact is added beyond what
    the transcript already contains (CLAUDE.md Principle 1).
    """
    if not transcript or not transcript.strip():
        return {field: "" for field in SOAP_FIELDS}

    raw = await _chat_completion(
        _SOAP_SYSTEM_PROMPT,
        f"TRANSCRIPT:\n{transcript.strip()}",
        temperature=0.0,
        response_format={"type": "json_object"},
        client=client,
        patient_names=patient_names,
    )
    obj = _extract_json_object(raw)
    # Normalise: guarantee all four keys as strings, ignore any extras.
    return {field: str(obj.get(field, "") or "").strip() for field in SOAP_FIELDS}


async def format_agent_prose(
    facts: dict[str, Any],
    agent_role: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    patient_names: Optional[list[str]] = None,
) -> str:
    """Turn structured graph facts into a conversational message for the AI
    Team drawer (Scribe / Consultant / Pharmacist / NPHIES).

    Formatting only — the model rephrases the supplied facts and adds nothing.
    """
    if not facts:
        return ""

    user_prompt = (
        f"AGENT ROLE: {agent_role}\n"
        f"FACTS (JSON, retrieved from the knowledge graph):\n"
        f"{json.dumps(facts, ensure_ascii=False, indent=2)}\n\n"
        "Rephrase ONLY these facts into a short conversational message."
    )
    raw = await _chat_completion(
        _AGENT_SYSTEM_PROMPT.format(agent_role=agent_role),
        user_prompt,
        temperature=0.2,
        client=client,
        patient_names=patient_names,
    )
    return raw.strip()
