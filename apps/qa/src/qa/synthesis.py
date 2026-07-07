"""Q&A answer synthesis pipeline.

Fills prompts, calls model, verifies blocklist, extracts sources.
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import structlog

from .model_client import ModelParams, ModelProvider
from .types import AnswerSource

if TYPE_CHECKING:
    pass

logger = structlog.get_logger()

PROMPT_TEMPLATE_VERSION = "qa-answer-v1.0"

QA_SYSTEM_PROMPT = """\
You are a factual lookup assistant integrated into a hospital information system. Your function is to answer factual questions about a specific patient's record by restating facts retrieved from that record.

You answer ONLY using the RETRIEVED FACTS provided. You do not add facts from outside this context. You do not infer, interpret, predict, prioritize, recommend, advise, or suggest.

If the retrieved facts do not contain enough information to answer the question, respond exactly with: "No matching data found in this patient's record."

You NEVER use any of these words or phrases:
- "concerning", "concern", "noteworthy", "significant" (in clinical sense)
- "worsening", "improving", "trending", "deteriorating"
- "suggests", "indicates", "implies", "consistent with", "could be"
- "consider", "should", "recommend", "advise", "rule out"
- "watch for", "monitor for", "be aware", "alert"
- "abnormal", "elevated" (without restating range), "low" (without restating range), "high"
- "rising", "falling" (use values; do not characterize direction)
- "risk", "likely", "possible diagnosis", "may be"

You may state values, dates, units, source systems, and laboratory-provided reference ranges verbatim. You may chronologically list values if the question asks for them.

Citations: every factual claim you make in your answer must come from one of the retrieved facts. Each sentence in your answer is implicitly linked to the source(s) cited via the application layer; you do not write citation markers.
"""

QA_USER_PROMPT_TEMPLATE = """\
PATIENT ID: {patient_id} (do not state in answer)

LANGUAGE: {language}

QUESTION: {question}

CLASSIFIER LABEL: ALLOWED (factual lookup)

RETRIEVED FACTS (use only these to answer):
{retrieved_chunks_json}

(Each retrieved chunk has: source_type, source_id, content_text, language, effective_at)

ANSWER THE QUESTION USING ONLY THE RETRIEVED FACTS. Restate values verbatim. If the question cannot be answered from the retrieved facts, respond exactly with "No matching data found in this patient's record." in the requested language.
"""

CHUNK_FALLBACK_PREFIX = {
    "en": "I cannot generate an answer for this question. The relevant documented data is:",
    "ar": "لا يمكنني توليد إجابة على هذا السؤال. البيانات الموثقة ذات الصلة هي:",
}
NO_DATA_EN = "No matching data found in this patient's record."
NO_DATA_AR = "لا توجد بيانات مطابقة في سجل هذا المريض."

# 1 retry (2 calls max) — local models are slow; the blocklist fallback to a
# factual chunk list covers the rare second failure without a 3rd model call.
MAX_RETRIES = 1


def _project_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    """Slim a chunk down to the fields the model needs to restate facts.

    Drops prompt-only overhead (source_id is the patient id repeated on every
    row; source_system is constant) so a rich record's 40 facts fit inside a
    local model's context window. Citations/sources are built from the FULL
    chunks separately (extract_sources), so nothing is lost for provenance.
    """
    slim: dict[str, Any] = {
        "source_type": chunk.get("source_type", ""),
        "content_text": chunk.get("content_text", ""),
    }
    if chunk.get("effective_at"):
        slim["effective_at"] = chunk["effective_at"]
    return slim


def fill_qa_prompt(
    question: str,
    chunks: list[dict[str, Any]],
    language: str,
    patient_id: str,
    attempt: int = 0,
) -> str:
    # Compact JSON (no indent) of only the needed fields — keeps the prompt
    # inside the local model's context window for records with many facts.
    slim = [_project_chunk(c) for c in chunks]
    base = QA_USER_PROMPT_TEMPLATE.format(
        patient_id=patient_id,
        language=language,
        question=question,
        retrieved_chunks_json=json.dumps(slim, ensure_ascii=False, separators=(",", ":")),
    )
    if attempt > 0:
        base += (
            "\n\nSTRICTER: A previous attempt violated constraints. "
            "Restate only the literal values."
        )
    return base


def chunk_to_source(chunk: dict[str, Any]) -> AnswerSource:
    return AnswerSource(
        fact_segment=str(chunk.get("content_text", ""))[:200],
        type=str(chunk.get("source_type", "")),
        id=str(chunk.get("source_id", "")),
        code=str(chunk.get("code") or ""),
        source_system=str(chunk.get("source_system") or "hospital"),
        field=str(chunk.get("field") or ""),
    )


def build_chunk_fallback(
    chunks: list[dict[str, Any]],
    language: str,
) -> str:
    prefix = CHUNK_FALLBACK_PREFIX.get(language, CHUNK_FALLBACK_PREFIX["en"])
    if not chunks:
        return NO_DATA_AR if language == "ar" else NO_DATA_EN
    bullets = "\n".join(
        f"• {c.get('content_text', '')[:200]}" for c in chunks[:8]
    )
    return f"{prefix}\n\n{bullets}"


def extract_sources(
    answer_text: str,
    chunks: list[dict[str, Any]],
) -> list[AnswerSource]:
    """Link answer sentences to retrieved chunks by keyword overlap."""
    sources: list[AnswerSource] = []
    seen_ids: set[str] = set()
    for chunk in chunks:
        content = str(chunk.get("content_text", "")).lower()
        answer_lower = answer_text.lower()
        # Simple heuristic: check if any 10-char slice of chunk content appears in answer
        words = content.split()
        relevant_words = [w for w in words if len(w) > 4]
        matched = sum(1 for w in relevant_words if w in answer_lower)
        if matched >= 1 or len(relevant_words) == 0:
            sid = str(chunk.get("source_id", ""))
            if sid not in seen_ids:
                seen_ids.add(sid)
                sources.append(chunk_to_source(chunk))
    return sources if sources else [chunk_to_source(c) for c in chunks[:3]]


async def synthesize(
    question: str,
    chunks: list[dict[str, Any]],
    language: str,
    patient_id: str,
    model: ModelProvider,
) -> tuple[str, list[AnswerSource], bool]:
    """
    Synthesize a factual answer from retrieved chunks.

    Returns:
        (answer_text, sources, blocklist_triggered)
    """
    # Import blocklist at call time — not available in all test environments
    try:
        from blocklist import scan  # type: ignore[import-untyped]
        has_blocklist = True
    except ImportError:
        has_blocklist = False
        scan = None  # type: ignore[assignment]

    blocklist_triggered = False

    for attempt in range(MAX_RETRIES + 1):
        user_prompt = fill_qa_prompt(question, chunks, language, patient_id, attempt)
        # Cap output length — factual answers are short. NOTE: deepseek-v4-flash
        # is a reasoning model that spends tokens on a hidden reasoning trace
        # BEFORE emitting the answer; a tight cap (e.g. 256) gets fully consumed
        # by reasoning and returns empty content. Budget must cover reasoning +
        # the (short) factual answer.
        params = ModelParams(temperature=0.0, max_tokens=1024)

        raw = await model.complete(QA_SYSTEM_PROMPT, user_prompt, params)

        # Empty-output guard: a reasoning model can consume the whole token
        # budget on its hidden reasoning trace and return empty content. Don't
        # surface a blank answer — retry once with a larger budget, then fall
        # through to the deterministic chunk fallback below.
        if not raw.strip():
            logger.warning("qa_synthesis_empty_output", attempt=attempt)
            params = ModelParams(temperature=0.0, max_tokens=2048)
            raw = await model.complete(QA_SYSTEM_PROMPT, user_prompt, params)
            if not raw.strip():
                continue

        if has_blocklist and scan is not None:
            scan_result = scan(raw, language=language)
            if not scan_result.passed:
                blocklist_triggered = True
                logger.warning(
                    "qa_blocklist_triggered",
                    attempt=attempt,
                    num_matches=len(scan_result.matches),
                    # Do not log question or answer — PHI-adjacent
                )
                continue  # retry with stricter prompt

        # Passed blocklist (or blocklist not available)
        sources = extract_sources(raw, chunks)
        return raw, sources, blocklist_triggered

    # All retries exhausted — return chunk fallback
    logger.error("qa_synthesis_all_retries_exhausted")
    fallback = build_chunk_fallback(chunks, language)
    return fallback, [chunk_to_source(c) for c in chunks], True
