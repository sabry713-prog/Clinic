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
import os
import re
from typing import Any, Optional

import httpx

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"
DEFAULT_TIMEOUT_S = 60.0

SOAP_FIELDS = ("subjective", "objective", "assessment", "plan")

# System prompts pin the model to formatting-only behaviour so it can never
# become a source of clinical facts (CLAUDE.md Principle 1).
from prompt_loader import load_prompt

_SOAP_SYSTEM_PROMPT = load_prompt("soap-format-prompt.md")

_AGENT_SYSTEM_PROMPT = load_prompt("agent-prose-prompt.md")

_CHECKLIST_SYSTEM_PROMPT = load_prompt("checklist-extract-prompt.md")


class DeepSeekError(RuntimeError):
    """Raised when the DeepSeek API call or response is unusable."""


def _api_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        raise DeepSeekError(
            "DEEPSEEK_API_KEY is not set. Export it before calling the "
            "DeepSeek client."
        )
    return key


async def _chat_completion(
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.0,
    response_format: Optional[dict[str, str]] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> str:
    """POST to DeepSeek's OpenAI-compatible /chat/completions and return the
    assistant message content. This is the single network boundary and the
    seam that tests patch.

    DATA-RESIDENCY GATE (CLAUDE.md §7 / PDPL): every outbound call passes
    through ``phi_guard.guard_outbound()``.  In-Kingdom endpoints are
    pass-through; external endpoints are governed by ``PHI_EGRESS_POLICY``
    (default: *block*).
    """
    base_url = os.environ.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    model = os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL)
    timeout = float(os.environ.get("DEEPSEEK_TIMEOUT_S", DEFAULT_TIMEOUT_S))
    endpoint_url = f"{base_url}/chat/completions"

    # DATA-RESIDENCY GATE (CLAUDE.md §7 / PDPL).
    from phi_guard import guard_outbound  # type: ignore[import-untyped]

    decision = guard_outbound(
        endpoint_url=endpoint_url,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        contains_phi=True,
    )

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": decision.system_prompt},
            {"role": "user", "content": decision.user_prompt},
        ],
        "temperature": temperature,
        "stream": False,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=timeout)
    try:
        resp = await client.post(
            endpoint_url, json=payload, headers=headers
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
        return decision.restore(raw)
    except (KeyError, IndexError, TypeError) as exc:
        raise DeepSeekError(f"Unexpected DeepSeek response shape: {data!r}") from exc


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


def _normalize_for_match(text: str) -> str:
    """Lowercase and collapse whitespace so quote verification is robust
    to line breaks and speaker prefixes, but still verbatim-anchored."""
    return " ".join(text.lower().split())


async def extract_checklist(
    transcript: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> list[dict[str, str]]:
    """Extract the clinician's own stated action items from a transcript.

    Extraction-only (CLAUDE.md Principle 1): the model lifts items the
    clinician explicitly said; it never recommends. Every item carries a
    supporting_quote the caller must verify against the transcript (see
    model_router.verify_checklist_items) before showing it to a clinician.
    """
    if not transcript or not transcript.strip():
        return []

    raw = await _chat_completion(
        _CHECKLIST_SYSTEM_PROMPT,
        f"TRANSCRIPT:\n{transcript.strip()}",
        temperature=0.0,
        response_format={"type": "json_object"},
        client=client,
    )
    obj = _extract_json_object(raw)
    items = obj.get("items")
    if not isinstance(items, list):
        return []
    cleaned: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", "") or "").strip()
        quote = str(item.get("supporting_quote", "") or "").strip()
        if label and quote:
            cleaned.append({"label": label[:80], "supporting_quote": quote[:400]})
    return cleaned


async def generate_soap_note(
    transcript: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
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
    )
    obj = _extract_json_object(raw)
    # Normalise: guarantee all four keys as strings, ignore any extras.
    return {field: str(obj.get(field, "") or "").strip() for field in SOAP_FIELDS}


async def format_agent_prose(
    facts: dict[str, Any],
    agent_role: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
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
    )
    return raw.strip()
