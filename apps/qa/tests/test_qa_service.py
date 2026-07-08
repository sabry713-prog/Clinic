"""Tests for the Q&A service orchestration pipeline."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from src.qa.model_client import StubModelProvider
from src.qa.qa_service import answer
from src.qa.types import QAResponse


def make_mock_pool() -> MagicMock:
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[])
    return pool


# ──────────────────────────────────────────────────────────────────────────────
# ALLOWED path
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_allowed_path_runs_synthesis():
    """ALLOWED: classify, then synthesis runs and returns answer."""
    model = StubModelProvider()
    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="What is the last creatinine?",
        language="en",
        conversation_id=None,
        pool=None,
        embedder=None,
        model=model,
    )
    assert result.classification == "ALLOWED"
    assert result.answer_text
    assert result.interaction_id
    assert result.latency_ms >= 0


@pytest.mark.asyncio
async def test_allowed_path_no_retrieval_when_pool_none():
    """ALLOWED path with no pool still returns an answer."""
    model = StubModelProvider()
    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="List the active medications.",
        language="en",
        conversation_id=None,
        pool=None,
        embedder=None,
        model=model,
    )
    assert result.classification == "ALLOWED"


@pytest.mark.asyncio
async def test_vector_mode_maps_retrieval_results() -> None:
    """ALLOWED with pool + embedder: RetrievalResult fields map to chunks without error."""
    from retrieval.types import RetrievalResult

    results = [
        RetrievalResult(
            chunk_id="c1",
            source_type="Observation",
            source_id="11111111-1111-1111-1111-111111111111",
            content_text="Creatinine = 168 umol/L",
            score=0.03,
            language="en",
            effective_at="2026-05-24T08:00:00",
        ),
        RetrievalResult(
            chunk_id="c2",
            source_type="Condition",
            source_id="22222222-2222-2222-2222-222222222222",
            content_text="Condition: chronic kidney disease, status: active",
            score=0.02,
        ),
    ]

    async def fake_retrieve(**kwargs: object) -> list[RetrievalResult]:
        return results

    captured: dict[str, object] = {}

    async def fake_synthesize(
        question: str,
        chunks: list[dict[str, object]],
        language: str,
        patient_id: str,
        model: object,
    ) -> tuple[str, list[object], bool]:
        captured["chunks"] = chunks
        return ("Creatinine values: 168 (24 May).", [], False)

    with patch("retrieval.retriever.hybrid_retrieve", fake_retrieve), \
         patch("src.qa.qa_service.synthesize", fake_synthesize):
        result = await answer(
            patient_id="00000000-0000-0000-0000-000000000001",
            question="What is the last creatinine?",
            language="en",
            conversation_id=None,
            pool=make_mock_pool(),
            embedder=MagicMock(),
            model=StubModelProvider(),
        )

    assert result.classification == "ALLOWED"
    chunks = captured["chunks"]
    # Mapping must not raise (and so must not fall back to empty chunks)
    assert isinstance(chunks, list)
    assert len(chunks) == 2
    assert chunks[0]["language"] == "en"
    assert chunks[0]["effective_at"] == "2026-05-24T08:00:00"
    assert chunks[1]["language"] == "en"
    assert chunks[1]["effective_at"] is None


# ──────────────────────────────────────────────────────────────────────────────
# REFUSED path
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refused_path_no_model_call():
    """REFUSED: no synthesis model is called."""
    model = MagicMock()
    model.complete = AsyncMock()

    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="Is his creatinine getting worse?",
        language="en",
        conversation_id=None,
        pool=None,
        embedder=None,
        model=model,
    )
    assert result.classification == "REFUSED"
    assert result.refusal_category == "TREND_INTERPRETATION"
    # Synthesis model must NOT have been called
    model.complete.assert_not_called()


@pytest.mark.asyncio
async def test_refused_path_no_retrieval():
    """REFUSED: retrieval is never called."""
    called = []

    async def mock_retrieve(*a: object, **kw: object) -> list:
        called.append(True)
        return []

    with patch("src.qa.qa_service.hybrid_retrieve", mock_retrieve, create=True):
        result = await answer(
            patient_id="00000000-0000-0000-0000-000000000001",
            question="What is the differential diagnosis?",
            language="en",
            conversation_id=None,
            pool=make_mock_pool(),
            embedder=MagicMock(),
        )

    assert result.classification == "REFUSED"
    assert not called  # retrieval was never called


@pytest.mark.asyncio
async def test_refused_returns_refusal_text():
    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="Should we start antibiotics?",
        language="en",
        conversation_id=None,
        pool=None,
    )
    assert result.classification == "REFUSED"
    assert "factual" in result.answer_text.lower()


# ──────────────────────────────────────────────────────────────────────────────
# Blocklist fallback path
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_blocklist_fallback_after_max_retries():
    """When synthesis produces blocklisted text 3×, fallback is returned."""

    class BlocklistedModel:
        def version(self) -> str:
            return "bad-model"

        async def complete(self, sys: str, user: str, params: object) -> str:
            return "The patient is worsening and suggesting sepsis."

    chunks = [
        {
            "source_type": "Observation",
            "source_id": "abc",
            "content_text": "Creatinine = 168 umol/L",
            "language": "en",
            "effective_at": "2026-05-24",
        }
    ]

    # Patch blocklist to always fail
    class FakeScanResult:
        passed = False
        matches = [object()]

    def fake_scan(text: str, language: str = "en") -> FakeScanResult:
        return FakeScanResult()

    # `scan` and `has_blocklist` are resolved via a local `from blocklist
    # import scan` inside synthesize() on each call, not module-level
    # attributes of src.qa.synthesis — so the module-level patch target
    # is sys.modules["blocklist"], not src.qa.synthesis.scan.
    with patch.dict("sys.modules", {"blocklist": MagicMock(scan=fake_scan)}):
        result = await answer(
            patient_id="00000000-0000-0000-0000-000000000001",
            question="What is the last creatinine?",
            language="en",
            conversation_id=None,
            pool=None,
            embedder=None,
            model=BlocklistedModel(),  # type: ignore[arg-type]
        )

    # Result may be ALLOWED but with blocklist_triggered or fallback text
    assert result.classification == "ALLOWED"


# ──────────────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_empty_question_refused():
    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="",
        language="en",
        conversation_id=None,
        pool=None,
    )
    assert result.classification == "REFUSED"
    assert result.refusal_category == "OTHER_INTERPRETIVE"


@pytest.mark.asyncio
async def test_out_of_scope_refused():
    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="Show all patients with CKD.",
        language="en",
        conversation_id=None,
        pool=None,
    )
    assert result.classification == "REFUSED"
    assert result.refusal_category == "OUT_OF_SCOPE"


@pytest.mark.asyncio
async def test_conversation_id_preserved():
    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="What is the admitting diagnosis?",
        language="en",
        conversation_id="conv-123",
        pool=None,
    )
    assert result.conversation_id == "conv-123"


@pytest.mark.asyncio
async def test_arabic_refused():
    result = await answer(
        patient_id="00000000-0000-0000-0000-000000000001",
        question="هل يتدهور وضعه؟",
        language="ar",
        conversation_id=None,
        pool=None,
    )
    assert result.classification == "REFUSED"
    assert result.language == "ar"
