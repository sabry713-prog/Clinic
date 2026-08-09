"""Ambient medical-term extraction tests.

Covers:
  - Happy path: model returns genuinely verbatim terms with categories.
  - Fabricated (non-verbatim) term is dropped, not trusted.
  - Case-insensitive de-dup of a term returned twice.
  - Unknown category is normalized to "other" rather than rejected outright.
  - Unparseable response retries then falls back to an empty (never fabricated) list.
  - Empty transcript short-circuits without calling the model.
  - Stub model (the default) always returns an empty list.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from transcription.extract_terms import (  # noqa: E402
    MAX_RETRIES,
    _StubExtractModel,
    extract_terms,
)

TRANSCRIPT = (
    "Patient reports a cough for three days. No fever. "
    "Start amoxicillin 500mg three times daily. Chest x-ray requested."
)


class _FixedModel:
    def __init__(self, response: str) -> None:
        self._response = response
        self.calls = 0

    def version(self) -> str:
        return "fixed-test"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.calls += 1
        return self._response


@pytest.mark.asyncio
async def test_verbatim_terms_are_kept_with_categories():
    response = json.dumps([
        {"term": "cough", "category": "symptom"},
        {"term": "amoxicillin 500mg", "category": "medication"},
        {"term": "Chest x-ray", "category": "test_or_procedure"},
    ])
    model = _FixedModel(response)
    result = await extract_terms(TRANSCRIPT, "en", model)

    terms = {t.term: t.category for t in result.terms}
    assert terms["cough"] == "symptom"
    assert terms["amoxicillin 500mg"] == "medication"
    assert terms["Chest x-ray"] == "test_or_procedure"
    assert result.retries == 0
    assert model.calls == 1


@pytest.mark.asyncio
async def test_fabricated_term_is_dropped_not_trusted():
    response = json.dumps([
        {"term": "cough", "category": "symptom"},
        {"term": "pneumonia", "category": "diagnosis_or_condition"},  # never said -- fabricated
    ])
    model = _FixedModel(response)
    result = await extract_terms(TRANSCRIPT, "en", model)

    terms = [t.term for t in result.terms]
    assert "cough" in terms
    assert "pneumonia" not in terms


@pytest.mark.asyncio
async def test_duplicate_term_is_deduped_case_insensitively():
    response = json.dumps([
        {"term": "cough", "category": "symptom"},
        {"term": "Cough", "category": "symptom"},
    ])
    model = _FixedModel(response)
    result = await extract_terms(TRANSCRIPT, "en", model)

    assert len(result.terms) == 1


@pytest.mark.asyncio
async def test_unknown_category_is_normalized_to_other():
    response = json.dumps([{"term": "cough", "category": "something-made-up"}])
    model = _FixedModel(response)
    result = await extract_terms(TRANSCRIPT, "en", model)

    assert result.terms[0].category == "other"


@pytest.mark.asyncio
async def test_unparseable_response_retries_then_falls_back_to_empty():
    model = _FixedModel("not valid json at all")
    result = await extract_terms(TRANSCRIPT, "en", model)

    assert result.terms == []
    assert result.retries == MAX_RETRIES
    assert model.calls == MAX_RETRIES + 1


@pytest.mark.asyncio
async def test_empty_transcript_short_circuits():
    model = _FixedModel("should never be called")
    result = await extract_terms("   ", "en", model)

    assert result.terms == []
    assert result.retries == 0
    assert model.calls == 0


@pytest.mark.asyncio
async def test_stub_model_always_returns_empty_list():
    result = await extract_terms(TRANSCRIPT, "en", _StubExtractModel())

    assert result.terms == []
