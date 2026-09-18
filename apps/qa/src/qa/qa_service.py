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
    from classifier import classify

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
    #
    # M10: the route is chosen and named, never blurred.  The index is used when
    # the patient has chunks in it, ranked lexically by the packaged retriever;
    # otherwise the record is read directly and every fact carries the immutable
    # id of the row it came from.  A hybrid route needs an *evaluated* embedding
    # model -- create_embedder() refuses the development stub, whose vectors are
    # seeded from a hash -- so a deployment without one stays lexical rather than
    # presenting an arbitrary cosine order as relevance.
    retrieval_path = "override" if _override_chunks is not None else "none"
    chunks: list[dict[str, Any]] = list(_override_chunks or [])
    if _override_chunks is None and pool is not None:
        try:
            from .fact_contract import retrieve_patient_chunks

            outcome = await retrieve_patient_chunks(
                pool=pool,
                patient_id=patient_id,
                question=question,
                language=lang,
                mode="hybrid" if embedder is not None else "lexical",
                embedder=embedder,
                top_k=8,
            )
            chunks = list(outcome.chunks)
            retrieval_path = outcome.path
        except Exception as exc:  # noqa: BLE001
            logger.warning("qa_retrieval_failed", error=str(exc), patient_id=patient_id)
    logger.info(
        "qa_retrieved",
        patient_id=patient_id,
        path=retrieval_path,
        chunks=len(chunks),
        embedding_model=embedder.model_id() if embedder is not None else "none",
    )

    # Step 3: Synthesize
    from .model_client import StubModelProvider, _question_terms
    _model = model if model is not None else StubModelProvider()

    # Bound the prompt: send only the question-relevant facts (so a rich record
    # doesn't overflow a local model's context window). Rank by keyword overlap;
    # keep the top N, falling back to the first N when nothing scores.
    MAX_SYNTH_CHUNKS = 40
    if len(chunks) > MAX_SYNTH_CHUNKS:
        terms = _question_terms(question)
        scored = sorted(
            chunks,
            key=lambda c: sum(1 for t in terms if t in str(c.get("content_text", "")).lower()),
            reverse=True,
        )
        chunks = scored[:MAX_SYNTH_CHUNKS]

    answer_text, sources, blocklist_triggered = await synthesize(
        question=question,
        chunks=chunks,
        language=lang,
        patient_id=patient_id,
        model=_model,
    )

    # A citation is kept only if the row behind it is still in this patient's
    # record.  Failing closed is the point: an answer that cannot verify its
    # evidence says nothing rather than citing a record it never checked.
    if pool is not None and sources:
        try:
            from .fact_contract import filter_resolved_sources

            sources, unresolved = await filter_resolved_sources(
                pool, patient_id, sources, chunks
            )
            if unresolved:
                logger.warning(
                    "qa_sources_dropped",
                    patient_id=patient_id,
                    unresolved=len(unresolved),
                    kept=len(sources),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("qa_source_filter_failed", error=str(exc), patient_id=patient_id)
            sources = []

    # Existence was asked above; support is a different question, and C03 was that nobody
    # asked it. The list is deliberately **not** narrowed here: an unsupported citation is
    # evidence that the answer drifted from its sources, and a shorter citation list would
    # hide that drift while looking tidier. The floor in `verify_support` is lexical, so
    # dropping on it could also discard a true citation -- so it reports, and the decision
    # stays with whoever reads the log.
    if sources:
        try:
            from .fact_contract import verify_support

            _supported, unsupported = verify_support(answer_text, sources)
            if unsupported:
                logger.warning(
                    "qa_sources_unsupported",
                    patient_id=patient_id,
                    unsupported=len(unsupported),
                    checked=len(sources),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("qa_support_check_failed", error=str(exc), patient_id=patient_id)

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
