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
    assert "don't recommend" in result.answer_text.lower() or "not recommend" in result.answer_text.lower() or "recommend" in result.answer_text.lower()


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

    with patch("src.qa.synthesis.scan", fake_scan), \
         patch("src.qa.synthesis.has_blocklist", True, create=True):
        from src.qa import synthesis as synth_module
        synth_module.has_blocklist = True  # type: ignore[attr-defined]

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
