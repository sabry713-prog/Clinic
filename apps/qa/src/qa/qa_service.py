"""Q&A service orchestration: classify → retrieve → synthesize OR refuse."""
from __future__ import annotations

import re
import time
import uuid
from typing import TYPE_CHECKING, Any, Optional

import structlog

from .refusal import PROMPT_TEMPLATE_VERSION as REFUSAL_PROMPT_VERSION
from .refusal import build_refusal
from .synthesis import PROMPT_TEMPLATE_VERSION as ANSWER_PROMPT_VERSION
from .synthesis import synthesize
from .types import AnswerSource, QAResponse

if TYPE_CHECKING:
    import asyncpg
    from classifier.model_layer import ModelClassifier
    from retrieval.embedder import EmbeddingProvider

    from .model_client import ModelProvider

logger = structlog.get_logger()

DISCLAIMER = (
    "Factual lookup only. Not a clinical interpretation. For clinician review only."
)
DISCLAIMER_AR = "بحث واقعي فقط. لا يمثل تفسيراً سريرياً. للمراجعة من قِبَل الطاقم الطبي فقط."


def _elapsed(start_ms: float) -> int:
    return int((time.monotonic() * 1000) - start_ms)


_ARABIC_RE = re.compile("[؀-ۿ]")  # Arabic Unicode block
_LATIN_RE = re.compile(r"[A-Za-z]")


def _detect_language(question: str, fallback: str) -> str:
    """Answer in the language the question was asked in (CLAUDE.md §8:
    Q&A must work in both languages, including code-switching).

    Any Arabic script wins (code-switched questions are answered in
    Arabic); otherwise Latin script means English; a question with
    neither (e.g. "CBC?") falls back to the caller's UI language.
    """
    if _ARABIC_RE.search(question):
        return "ar"
    if _LATIN_RE.search(question):
        return "en"
    return fallback if fallback in ("en", "ar") else "en"


async def answer(
    patient_id: str,
    question: str,
    language: str,
    conversation_id: Optional[str],
    pool: Optional["asyncpg.Pool[Any]"],
    embedder: Optional["EmbeddingProvider"] = None,
    model: Optional["ModelProvider"] = None,
    classifier_model: Optional["ModelClassifier"] = None,
    _override_chunks: Optional[list[dict[str, Any]]] = None,
) -> QAResponse:
    """
    Full Q&A pipeline:
    1. Classify the question (rule → model)
    2. If REFUSED: build deterministic refusal, return immediately (no retrieval, no LLM)
    3. If ALLOWED: retrieve chunks, synthesize answer, apply blocklist
    """
    from classifier import classify  # type: ignore[import-untyped]

    start_ms = time.monotonic() * 1000
    interaction_id = str(uuid.uuid4())
    conv_id = conversation_id or str(uuid.uuid4())
    lang = _detect_language(question, language)
    disc = DISCLAIMER if lang == "en" else DISCLAIMER_AR

    # Step 1: Classify
    clf_result = await classify(question, language=lang, model=classifier_model)

    logger.info(
        "qa_classified",
        interaction_id=interaction_id,
        patient_id=patient_id,  # not PHI
        classification=clf_result.label,
        refusal_category=clf_result.refusal_category,
        rule_matches=clf_result.rule_matches,
        layer=clf_result.layer,
        # Do NOT log question text
    )

    if clf_result.label == "REFUSED":
        # Deterministic refusal — no retrieval, no LLM synthesis
        refusal = await build_refusal(
            question=question,
            category=clf_result.refusal_category or "OTHER_INTERPRETIVE",
            patient_id=patient_id,
            language=lang,
            pool=pool,
        )
        return QAResponse(
            interaction_id=interaction_id,
            patient_id=patient_id,
            conversation_id=conv_id,
            question=question,
            classification="REFUSED",
            classifier_confidence=clf_result.confidence,
            refusal_category=clf_result.refusal_category or "OTHER_INTERPRETIVE",
            rule_matches=clf_result.rule_matches,
            language=lang,
            answer_text=refusal.text,
            sources=refusal.sources,
            model_version="",
            prompt_template_version=REFUSAL_PROMPT_VERSION,
            latency_ms=_elapsed(start_ms),
            disclaimer=disc,
            blocklist_triggered=False,
        )

    # Step 2: Retrieve (ALLOWED path only)
    chunks: list[dict[str, Any]] = _override_chunks if _override_chunks is not None else []
    if pool is not None and embedder is not None:
        try:
            from retrieval.retriever import hybrid_retrieve  # type: ignore[import-untyped]
            retrieval_results = await hybrid_retrieve(
                patient_id=patient_id,
                query=question,
                pool=pool,
                embedder=embedder,
                top_k=8,
                language=lang,
            )
            chunks = [
                {
                    "source_type": r.source_type,
                    "source_id": r.source_id,
                    "content_text": r.content_text,
                    "language": r.language,
                    "effective_at": r.effective_at,
                    "code": getattr(r, "code", ""),
                    "source_system": getattr(r, "source_system", "hospital"),
                    "field": getattr(r, "field", ""),
                }
                for r in retrieval_results
            ]
        except Exception as exc:  # noqa: BLE001
            logger.warning("qa_retrieval_failed", error=str(exc), patient_id=patient_id)

    # Step 3: Synthesize
    from .model_client import StubModelProvider
    _model = model if model is not None else StubModelProvider()

    answer_text, sources, blocklist_triggered = await synthesize(
        question=question,
        chunks=chunks,
        language=lang,
        patient_id=patient_id,
        model=_model,
    )

    return QAResponse(
        interaction_id=interaction_id,
        patient_id=patient_id,
        conversation_id=conv_id,
        question=question,
        classification="ALLOWED",
        classifier_confidence=clf_result.confidence,
        refusal_category="",
        rule_matches=clf_result.rule_matches,
        language=lang,
        answer_text=answer_text,
        sources=sources,
        model_version=_model.version(),
        prompt_template_version=ANSWER_PROMPT_VERSION,
        latency_ms=_elapsed(start_ms),
        disclaimer=disc,
        blocklist_triggered=blocklist_triggered,
    )
