"""Faithful on-prem LLM reformat (docs/prompts/reformat-prompt.md).

Polishes the clinician's OWN dictated words into professional prose WITHOUT
adding or changing clinical content. On-prem only (CLAUDE.md §7). Returns None
on any failure so the caller falls back to deterministic light reformat.
"""
from __future__ import annotations

import httpx
import structlog

from .config import settings

logger = structlog.get_logger()

from prompt_loader import load_prompt

_SYSTEM = load_prompt("reformat-prompt.md")


async def faithful_reformat(transcript: str, language: str) -> str | None:
    if settings.transcription_reformat.lower() != "llm" or not settings.model_name:
        return None
    payload = {
        "model": settings.model_name,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"LANGUAGE: {language}\n\nCLINICIAN DICTATION (clean this faithfully — do not add or change content):\n{transcript}"},
        ],
        "temperature": 0.0,
        "max_tokens": 800,
        "stream": False,
    }
    url = settings.model_endpoint_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.model_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=settings.model_timeout_s) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return str(data["choices"][0]["message"]["content"]).strip()
    except Exception as exc:  # noqa: BLE001 — fall back to deterministic reformat
        logger.warning("faithful_reformat_failed_fallback", error=str(exc))
        return None
