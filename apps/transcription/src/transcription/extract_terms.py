"""Ambient medical-term extraction (docs/prompts/ambient-term-extraction-prompt.md).

Points out which existing spans of an already-transcribed dictation are medical
terminology (medication, symptom, diagnosis/condition, test/procedure, other)
WITHOUT paraphrasing, summarizing, or adding a single word -- same "relocate,
never rewrite" shape as segment.py, applied to term-spotting instead of
section-classification.

The real safety mechanism is not the prompt -- it's the server-side verbatim
check below: a term is kept ONLY if it is a verified (whitespace/case-
insensitive) substring of the source transcript (is_verbatim_substring(),
shared with segment.py). Any term that fails verification is dropped, never
partially trusted. This is reference-only output -- it is never submitted into
a draft and never re-verified elsewhere, unlike segmentation/condensation
output, so this is the ONLY safety gate for this feature.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx
import structlog

from .config import settings
from .verbatim import is_verbatim_substring, normalize_ws

logger = structlog.get_logger()

MAX_RETRIES = 2
CATEGORIES = ("medication", "symptom", "diagnosis_or_condition", "test_or_procedure", "other")


@runtime_checkable
class TermExtractionModelProvider(Protocol):
    """Minimal model interface for term extraction -- same narrow shape as
    SegmentModelProvider in segment.py."""

    async def complete(self, system_prompt: str, user_prompt: str) -> str: ...

    def version(self) -> str: ...


@dataclass(frozen=True)
class ExtractedTerm:
    term: str
    category: str


@dataclass(frozen=True)
class ExtractTermsResult:
    terms: list[ExtractedTerm]
    retries: int


from prompt_loader import load_prompt

_SYSTEM = load_prompt("ambient-term-extraction-prompt.md")


def _try_parse(raw: str) -> list[object] | None:
    try:
        data = json.loads(raw.strip())
    except (json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, list) else None


async def extract_terms(
    text: str,
    language: str,
    model: TermExtractionModelProvider,
) -> ExtractTermsResult:
    """Return an ExtractTermsResult. Never fabricates a term -- every returned
    term is independently verified as a verbatim substring of the transcript;
    anything that fails verification is dropped, not retried (terms are
    independent of each other, unlike segmentation's exclusive partition)."""
    if not text.strip():
        return ExtractTermsResult(terms=[], retries=0)

    user_prompt = (
        f"LANGUAGE: {language}\n\n"
        f"CATEGORIES (classify each term into exactly one): {', '.join(CATEGORIES)}\n\n"
        f"TRANSCRIPT (point out verbatim medical terms from this text only -- do not alter any word):\n{text}"
    )

    for attempt in range(MAX_RETRIES + 1):
        prompt = user_prompt
        if attempt > 0:
            prompt += (
                "\n\nYour previous attempt was not valid JSON. Retry using ONLY exact copied terms "
                "from the transcript, output as a single JSON array of {\"term\", \"category\"} objects."
            )

        raw = await model.complete(_SYSTEM, prompt)
        parsed = _try_parse(raw)
        if parsed is None:
            logger.warning("extract_terms_unparseable_response", attempt=attempt)
            continue

        seen: set[str] = set()
        terms_out: list[ExtractedTerm] = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            term = item.get("term")
            category = item.get("category")
            if not isinstance(term, str) or not term.strip():
                continue
            if not is_verbatim_substring(term, text):
                logger.warning("extract_terms_dropped_non_verbatim", attempt=attempt)
                continue
            category_norm = category if category in CATEGORIES else "other"
            key = normalize_ws(term)
            if key in seen:
                continue
            seen.add(key)
            terms_out.append(ExtractedTerm(term=term.strip(), category=category_norm))

        return ExtractTermsResult(terms=terms_out, retries=attempt)

    # Exhausted retries without ever getting parseable JSON -- nothing is
    # trusted, nothing is fabricated: an empty reference list is always safe.
    return ExtractTermsResult(terms=[], retries=MAX_RETRIES)


class _StubExtractModel:
    """Dev/test default: never extracts anything. Safe -- exercises the full
    pipeline (returns a valid empty JSON array every time) with no real model
    configured, same spirit as segment.py's _StubSegmentModel and condense.py's
    subtractive-only stub."""

    def version(self) -> str:
        return "stub-extract-terms-v1"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        return "[]"


class _LlmExtractModel:
    """On-prem LLM term extraction via the same OpenAI-compatible endpoint used
    by faithful_reformat()/segment_transcript()."""

    def version(self) -> str:
        return settings.model_name or "llm-extract-terms"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "model": settings.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 1024,
            "stream": False,
        }
        url = settings.model_endpoint_url.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {settings.model_api_key}"}
        async with httpx.AsyncClient(timeout=settings.model_timeout_s) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return str(data["choices"][0]["message"]["content"]).strip()


def get_term_extraction_model() -> TermExtractionModelProvider:
    if settings.transcription_term_extraction.lower() == "llm" and settings.model_name:
        return _LlmExtractModel()
    return _StubExtractModel()
