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

_SYSTEM = (
    "You are a medical scribe assistant. You receive a clinician's dictated text and "
    "return it cleaned up into professional clinical prose. You are NOT a clinical "
    "decision aid.\n"
    "ABSOLUTE RULES:\n"
    "1. Reproduce ONLY what the clinician said. Do NOT add, infer, expand, or supply any "
    "clinical content, finding, diagnosis, recommendation, or value the clinician did not state.\n"
    "2. You MAY: fix grammar, spelling, punctuation; remove filler, false starts, repetitions; "
    "split run-on speech into clear sentences and paragraphs; apply standard headings only if the "
    "clinician's words map to them.\n"
    "3. You may NOT: change clinical meaning, rephrase into a different clinical assertion, "
    "translate lay terms into diagnoses or vice versa, or add hedging/interpretation.\n"
    "4. Preserve verbatim: drug names, doses, lab values, numbers, units, dates, named diagnoses.\n"
    "5. Write in the SAME language as the dictation. Do not translate.\n"
    "6. If the dictation is empty or unintelligible, return it unchanged.\n"
    "Output ONLY the cleaned text — no preamble, no commentary, no added sections."
)


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
