"""Tests for the patient-facing plain-language recap.

Covers:
  - Happy path: model returns compliant text, recap is returned unchanged.
  - Blocklist retry: model returns interpretive text every attempt, all
    retries exhausted, caller gets None (falls back to clinical summary).
  - Blocklist retry then success: first attempt blocked, second passes.
  - Empty source text short-circuits without calling the model.
"""
from __future__ import annotations

import pytest

from src.narrative.model_client import ModelParams
from src.narrative.patient_recap import MAX_RETRIES, generate_patient_recap


class _FixedModel:
    """Returns the same text every call."""

    def __init__(self, text: str) -> None:
        self._text = text
        self.calls = 0

    def version(self) -> str:
        return "fixed-test"

    async def complete(self, system_prompt: str, user_prompt: str, params: ModelParams) -> str:
        self.calls += 1
        return self._text


class _SequenceModel:
    """Returns a different text on each successive call."""

    def __init__(self, texts: list[str]) -> None:
        self._texts = texts
        self.calls = 0

    def version(self) -> str:
        return "sequence-test"

    async def complete(self, system_prompt: str, user_prompt: str, params: ModelParams) -> str:
        text = self._texts[min(self.calls, len(self._texts) - 1)]
        self.calls += 1
        return text


@pytest.mark.asyncio
async def test_compliant_text_returned() -> None:
    model = _FixedModel("Your record shows documented hypertension. Creatinine: 168 umol/L [59-104 umol/L].")
    text, triggered, retries = await generate_patient_recap(
        narrative_text="Documented hypertension. Creatinine: 168 umol/L [59-104 umol/L].",
        language="en",
        model=model,
    )
    assert text is not None
    assert triggered is False
    assert retries == 0
    assert model.calls == 1


@pytest.mark.asyncio
async def test_interpretive_text_exhausts_retries_and_falls_back() -> None:
    model = _FixedModel("Creatinine is elevated and concerning, suggesting worsening kidney function.")
    text, triggered, retries = await generate_patient_recap(
        narrative_text="Creatinine: 168 umol/L [59-104 umol/L].",
        language="en",
        model=model,
    )
    assert text is None
    assert triggered is True
    assert retries == MAX_RETRIES
    assert model.calls == MAX_RETRIES + 1


@pytest.mark.asyncio
async def test_recovers_after_one_blocked_attempt() -> None:
    model = _SequenceModel([
        "This is concerning and suggests worsening renal function.",
        "Your record shows: Creatinine 168 umol/L [59-104 umol/L].",
    ])
    text, triggered, retries = await generate_patient_recap(
        narrative_text="Creatinine: 168 umol/L [59-104 umol/L].",
        language="en",
        model=model,
    )
    assert text is not None
    assert triggered is True
    assert retries == 1
    assert model.calls == 2


@pytest.mark.asyncio
async def test_empty_source_short_circuits() -> None:
    model = _FixedModel("should never be called")
    text, triggered, retries = await generate_patient_recap(
        narrative_text="   ",
        language="en",
        model=model,
    )
    assert text is None
    assert triggered is False
    assert retries == 0
    assert model.calls == 0
