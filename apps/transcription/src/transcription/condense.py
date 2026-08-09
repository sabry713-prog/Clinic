"""Ambient section condensation (docs/prompts/ambient-condensation-prompt.md).

Unlike segment.py (which only RELOCATES verbatim spans into sections, never
altering a single word), this module lets a model lightly paraphrase/tighten
a section's text into note-style prose -- but ONLY for non-judgment sections
(CONDENSABLE_SECTIONS). Assessment/Plan never reach this module; that
exclusion is a hard, server-side constant, never client-configurable.

Because the input here is raw, unvetted transcript content (not the already
fact-grounded structured data the narrative pipeline works from), the
blocklist alone is not sufficient. validate_condensation() requires BOTH:
  1. blocklist.scan() passes (no interpretive/judgment language), AND
  2. every content word in the condensed output already appears somewhere in
     the source text (word_containment_check) -- looser than is_verbatim_substring
     (allows reordering and dropping filler) but strictly prevents introducing
     a NEW clinical term/concept that wasn't said. NOTE: this is exact-word
     matching, not stemming/lemmatization -- "fever" and "febrile" are
     different words to this check, so a synonym substitution is (correctly,
     conservatively) rejected same as a fabricated new term would be.

Retry-then-fallback mirrors narrative_service.py's exact shape: up to
MAX_RETRIES stricter-suffix retries, then fall back to the ORIGINAL verbatim
text unchanged -- never fabricate, never block the note.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx
import structlog
from blocklist import scan as blocklist_scan

from .config import settings

logger = structlog.get_logger()

MAX_RETRIES = 2

# Assessment/Plan are structurally excluded -- this set is the sole authority
# on what may ever be condensed, both here and re-checked in apps/core's
# draft.service.ts. A client asserting a non-member key was "condensed" is
# never trusted (see docs/prompts/ambient-condensation-prompt.md).
CONDENSABLE_SECTIONS = frozenset({"chief_complaint", "history"})

_WORD_RE = re.compile(r"[a-zA-Z؀-ۿ]{3,}")
_STOPWORDS = frozenset({
    "the", "a", "an", "is", "are", "was", "were", "and", "or", "but", "of", "to",
    "in", "on", "at", "for", "with", "it", "this", "that", "he", "she", "they",
    "i", "we", "you", "said", "says", "stated", "reports", "reported", "also",
})


@runtime_checkable
class CondenseModelProvider(Protocol):
    """Same minimal shape as segment.py's SegmentModelProvider."""

    async def complete(self, system_prompt: str, user_prompt: str) -> str: ...

    def version(self) -> str: ...


@dataclass(frozen=True)
class CondenseResult:
    text: str
    condensed: bool
    retries: int


_SYSTEM = """\
You condense one section of a clinical encounter note into tighter, standard note-style prose.

ABSOLUTE RULES:
1. Do NOT add any clinical fact, term, finding, diagnosis, severity, or instruction that is not already explicitly present in the source text.
2. Do NOT interpret, infer, or draw any conclusion — including about severity or urgency.
3. You MAY remove filler words and conversational padding, reorder for clarity, and use standard abbreviations for terms already stated.
4. Preserve all clinical terms, medication names, doses, and quantities EXACTLY as given.
5. Output ONLY the condensed section text. No commentary, no markdown, no explanation.
"""

_STRICTER_SUFFIX = (
    "\n\nSTRICTER: Do not introduce any word or concept not already present in the source "
    "text. Only remove filler, reorder for clarity, or use standard abbreviations for terms "
    "already stated."
)


def _content_words(text: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(text) if w.lower() not in _STOPWORDS}


def word_containment_check(condensed_text: str, source_text: str) -> bool:
    """Every content word in condensed_text must already appear in source_text."""
    condensed_words = _content_words(condensed_text)
    if not condensed_words:
        return True
    return condensed_words.issubset(_content_words(source_text))


def validate_condensation(condensed_text: str, source_text: str, language: str) -> bool:
    """Single source of truth for condensation safety -- called both during
    initial generation (below) and again server-side by apps/core at
    draft-creation time (POST /validate-condensation), never trusting a
    client-supplied "this passed" claim."""
    if not condensed_text.strip():
        return False
    if not blocklist_scan(condensed_text, language=language).passed:
        return False
    return word_containment_check(condensed_text, source_text)


async def condense_section(
    section_key: str,
    verbatim_text: str,
    language: str,
    model: CondenseModelProvider,
) -> CondenseResult:
    if section_key not in CONDENSABLE_SECTIONS or not verbatim_text.strip():
        return CondenseResult(text=verbatim_text, condensed=False, retries=0)

    user_prompt = f"LANGUAGE: {language}\n\nSOURCE TEXT:\n{verbatim_text}"

    for attempt in range(MAX_RETRIES + 1):
        prompt = user_prompt if attempt == 0 else user_prompt + _STRICTER_SUFFIX
        raw = (await model.complete(_SYSTEM, prompt)).strip()
        if validate_condensation(raw, verbatim_text, language):
            return CondenseResult(text=raw, condensed=True, retries=attempt)
        logger.warning("condense_validation_failed", section_key=section_key, attempt=attempt)

    # Exhausted retries -- fall back to the original verbatim text, unchanged.
    return CondenseResult(text=verbatim_text, condensed=False, retries=MAX_RETRIES)


class _StubCondenseModel:
    """Dev/test default: SUBTRACTIVE-ONLY filler-strip. A transform that only
    removes words can never introduce a new one, so it always passes
    word_containment_check by construction -- safe by design, no real LLM
    needed for the default path (same spirit as segment.py's _StubSegmentModel)."""

    # Consumes one adjacent comma along with the filler phrase so removals
    # don't leave dangling ", ," runs behind. "like" is only treated as
    # filler when it carries its own trailing comma ("like, ...") -- a bare
    # "like" is usually a real content word ("looks like bronchitis" would
    # never reach here, but "feels like pressure" could).
    _FILLER_RE = re.compile(
        r"(?:[,،]\s*)?\b(um+|uh+|you know|i think|i guess|the patient said|the patient stated|kind of|sort of|like(?=\s*[,،]))\b(?:\s*[,،])?",
        re.IGNORECASE,
    )
    _WS_RE = re.compile(r"\s+")

    def version(self) -> str:
        return "stub-condense-v1"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        source = user_prompt.rsplit("SOURCE TEXT", 1)[-1].split(":", 1)[-1].strip()
        stripped = self._FILLER_RE.sub("", source)
        # Tidy punctuation orphaned by the removals -- still purely
        # subtractive (only ever deletes characters, never adds a word).
        stripped = re.sub(r"\s+([,.؟?!،])", r"\1", stripped)  # no space before punctuation
        stripped = re.sub(r"[,،](\s*[,،])+", ",", stripped)     # collapse comma runs
        stripped = re.sub(r"^\s*[,،]\s*", "", stripped)          # leading comma
        stripped = re.sub(r"[,،]\s*([.؟?!])", r"\1", stripped)  # comma before sentence end
        return self._WS_RE.sub(" ", stripped).strip()


class _LlmCondenseModel:
    """On-prem LLM condensation via the same OpenAI-compatible endpoint used
    by segment.py's _LlmSegmentModel."""

    def version(self) -> str:
        return settings.model_name or "llm-condense"

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


def get_condense_model() -> CondenseModelProvider:
    if settings.transcription_condensation.lower() == "llm" and settings.model_name:
        return _LlmCondenseModel()
    return _StubCondenseModel()
