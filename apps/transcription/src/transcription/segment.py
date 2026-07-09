"""Ambient transcript segmentation (docs/prompts/ambient-segmentation-prompt.md).

Classifies an already-transcribed clinician<->patient conversation into note
sections (e.g. chief complaint, history, assessment, plan) WITHOUT paraphrasing,
summarizing, or adding a single word. The model's ONLY job is to say which
section an existing span of text belongs to.

The real safety mechanism is not the prompt -- it's the server-side verbatim
check below: a response is accepted ONLY if every section value it returns is a
verified (whitespace/case-insensitive) substring of the source transcript,
exactly the same isClinicianAuthoredOnly invariant already used for
Assessment/Plan sections in apps/core/src/draft/draft.service.ts (ported here as
is_verbatim_substring()). If verification fails, the whole attempt is discarded
(never partially trusted) and retried; if retries are exhausted, the ENTIRE
original transcript is preserved verbatim in "unclassified" -- content is never
silently dropped, and fabricated content is never admitted.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx
import structlog

from .config import settings
from .verbatim import is_verbatim_substring

logger = structlog.get_logger()

MAX_RETRIES = 2
UNCLASSIFIED_KEY = "unclassified"


@runtime_checkable
class SegmentModelProvider(Protocol):
    """Minimal model interface for segmentation -- deliberately narrower than
    apps/narrative's ModelProvider (no temperature/token tuning needed here)."""

    async def complete(self, system_prompt: str, user_prompt: str) -> str: ...

    def version(self) -> str: ...


@dataclass(frozen=True)
class SectionSpec:
    key: str
    title: str


@dataclass(frozen=True)
class SegmentResult:
    sections: dict[str, str]  # key -> verbatim text (only keys with non-empty content)
    unclassified_text: str
    retries: int


_SYSTEM = """\
You classify a clinical encounter transcript into note sections. You do NOT write, paraphrase, summarize, correct, or add any content.

ABSOLUTE RULES:
1. Every span of text you place into a section MUST be copied VERBATIM (exact words, exact order) from the transcript. Do not paraphrase, summarize, reword, translate, or correct anything.
2. Do NOT add any word, sentence, finding, diagnosis, or instruction that is not already in the transcript.
3. Classify each part of the transcript into exactly one of the given section keys, based on what the speaker is doing (describing why they came in, describing history, stating an assessment/impression, stating a plan). If a part of the transcript does not clearly belong to any given section, place it under "unclassified" instead of forcing it into the wrong section or dropping it.
4. COMPLETENESS: every part of the transcript must appear in your output, in exactly one section (including "unclassified"). Do not omit anything.
5. Output ONLY a single JSON object mapping each given section key (plus "unclassified") to its assigned verbatim text (use an empty string for a key with nothing assigned). No commentary, no markdown code fences, no text outside the JSON object.
"""


def _section_list_text(sections: list[SectionSpec]) -> str:
    return "\n".join(f"- {s.key}: {s.title}" for s in sections)


def _try_parse(raw: str) -> dict[str, object] | None:
    try:
        data = json.loads(raw.strip())
    except (json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


async def segment_transcript(
    text: str,
    sections: list[SectionSpec],
    language: str,
    model: SegmentModelProvider,
) -> SegmentResult:
    """Return a SegmentResult. Never fabricates content and never drops content:
    a fully-verified classification, or a safe unclassified fallback containing
    the original transcript untouched -- never a partially-trusted hybrid."""
    if not text.strip():
        return SegmentResult(sections={}, unclassified_text="", retries=0)

    valid_keys = {s.key for s in sections}
    user_prompt = (
        f"LANGUAGE: {language}\n\n"
        f'SECTION KEYS (classify into exactly one of these, or "unclassified"):\n{_section_list_text(sections)}\n\n'
        f"TRANSCRIPT (classify verbatim spans of this text only -- do not alter any word):\n{text}"
    )

    for attempt in range(MAX_RETRIES + 1):
        prompt = user_prompt
        if attempt > 0:
            prompt += (
                "\n\nYour previous attempt included text that was not an exact verbatim "
                "match of the transcript, or was not valid JSON. Retry using ONLY exact "
                "copied spans from the transcript, output as a single JSON object."
            )

        raw = await model.complete(_SYSTEM, prompt)
        parsed = _try_parse(raw)
        if parsed is None:
            logger.warning("segment_unparseable_response", attempt=attempt)
            continue

        sections_out: dict[str, str] = {}
        unclassified = ""
        all_verbatim = True
        for key, value in parsed.items():
            if not isinstance(value, str) or not value.strip():
                continue
            if not is_verbatim_substring(value, text):
                all_verbatim = False
                break
            if key == UNCLASSIFIED_KEY:
                unclassified = value.strip()
            elif key in valid_keys:
                sections_out[key] = value.strip()
            else:
                all_verbatim = False  # unknown key -- treat as a malformed response
                break

        if all_verbatim and (sections_out or unclassified):
            return SegmentResult(sections=sections_out, unclassified_text=unclassified, retries=attempt)
        logger.warning("segment_verbatim_check_failed", attempt=attempt)

    # Exhausted retries -- nothing is trusted, nothing is dropped: the caller
    # falls back to the clinician reviewing the raw transcript directly.
    return SegmentResult(sections={}, unclassified_text=text, retries=MAX_RETRIES)


class _StubSegmentModel:
    """Dev/test default: puts everything in "unclassified" every time. Safe --
    exercises the full pipeline (retry loop always short-circuits successfully
    since an all-unclassified response is a valid, fully-verbatim response) with
    no real model configured, same spirit as engine.py's StubEngine."""

    def version(self) -> str:
        return "stub-segment-v1"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        transcript = user_prompt.rsplit("TRANSCRIPT", 1)[-1].split(":", 1)[-1].strip()
        return json.dumps({UNCLASSIFIED_KEY: transcript})


class _LlmSegmentModel:
    """On-prem LLM segmentation via the same OpenAI-compatible endpoint used by
    faithful_reformat() in reformat_llm.py (settings.model_endpoint_url)."""

    def version(self) -> str:
        return settings.model_name or "llm-segment"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "model": settings.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 2048,
            "stream": False,
        }
        url = settings.model_endpoint_url.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {settings.model_api_key}"}
        async with httpx.AsyncClient(timeout=settings.model_timeout_s) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return str(data["choices"][0]["message"]["content"]).strip()


def get_segmentation_model() -> SegmentModelProvider:
    if settings.transcription_segmentation.lower() == "llm" and settings.model_name:
        return _LlmSegmentModel()
    return _StubSegmentModel()
