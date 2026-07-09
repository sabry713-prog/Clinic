"""Tests for the Medical Interpreter (ad-hoc communication translation).

Covers:
  - Happy path: model returns compliant translation, returned unchanged.
  - Blocklist retry: model returns interpretive text every attempt, all
    retries exhausted, caller gets None (falls back to in-person interpreter).
  - Blocklist retry then success: first attempt blocked, second passes.
  - Empty source text short-circuits without calling the model.
"""
from __future__ import annotations

import pytest

from src.narrative.interpreter import MAX_RETRIES, translate_message
from src.narrative.model_client import ModelParams


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
async def test_compliant_translation_returned() -> None:
    model = _FixedModel("Please take Panadol twice daily. Your creatinine result was 168 umol/L.")
    text, triggered, retries = await translate_message(
        text="من فضلك خذ Panadol مرتين يومياً. نتيجة الكرياتينين لديك كانت 168 umol/L.",
        source_language="ar",
        target_language="en",
        model=model,
    )
    assert text is not None
    assert triggered is False
    assert retries == 0
    assert model.calls == 1


@pytest.mark.asyncio
async def test_interpretive_text_exhausts_retries_and_falls_back() -> None:
    model = _FixedModel("مستوى الكرياتينين لديك مرتفع وهذا مقلق، مما يشير إلى تدهور وظائف الكلى.")
    text, triggered, retries = await translate_message(
        text="Creatinine: 168 umol/L.",
        source_language="en",
        target_language="ar",
        model=model,
    )
    assert text is None
    assert triggered is True
    assert retries == MAX_RETRIES
    assert model.calls == MAX_RETRIES + 1


@pytest.mark.asyncio
async def test_recovers_after_one_blocked_attempt() -> None:
    model = _SequenceModel([
        "هذا مقلق ويشير إلى تدهور وظائف الكلى.",
        "نتيجة الكرياتينين لديك كانت 168 umol/L.",
    ])
    text, triggered, retries = await translate_message(
        text="Creatinine: 168 umol/L.",
        source_language="en",
        target_language="ar",
        model=model,
    )
    assert text is not None
    assert triggered is True
    assert retries == 1
    assert model.calls == 2


@pytest.mark.asyncio
async def test_empty_source_short_circuits() -> None:
    model = _FixedModel("should never be called")
    text, triggered, retries = await translate_message(
        text="   ",
        source_language="en",
        target_language="ar",
        model=model,
    )
    assert text is None
    assert triggered is False
    assert retries == 0
    assert model.calls == 0
