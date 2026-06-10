"""Tests for deterministic refusal builder."""
from __future__ import annotations

import pytest
from src.qa.refusal import REFUSAL_TEMPLATES, build_refusal


ALL_CATEGORIES = list(REFUSAL_TEMPLATES["en"].keys())


@pytest.mark.asyncio
@pytest.mark.parametrize("category", ALL_CATEGORIES)
async def test_refusal_returns_text(category: str):
    """Each category returns a non-empty text."""
    result = await build_refusal(
        question="What is the prognosis?",
        category=category,
        patient_id="00000000-0000-0000-0000-000000000001",
        language="en",
        pool=None,
    )
    assert result.text
    assert len(result.text) > 10


@pytest.mark.asyncio
@pytest.mark.parametrize("category", ALL_CATEGORIES)
async def test_refusal_arabic(category: str):
    """Arabic language returns Arabic template text."""
    result = await build_refusal(
        question="ما هو التشخيص؟",
        category=category,
        patient_id="00000000-0000-0000-0000-000000000001",
        language="ar",
        pool=None,
    )
    assert result.text
    # Arabic template should contain Arabic characters
    has_arabic = any("؀" <= c <= "ۿ" for c in result.text)
    assert has_arabic, f"Category {category} arabic template has no Arabic chars"


@pytest.mark.asyncio
async def test_refusal_trend_no_pool():
    """TREND_INTERPRETATION with no pool returns graceful fallback."""
    result = await build_refusal(
        question="Is kidney function getting worse?",
        category="TREND_INTERPRETATION",
        patient_id="00000000-0000-0000-0000-000000000001",
        language="en",
        pool=None,
    )
    assert "don't interpret" in result.text.lower() or "interpret" in result.text.lower()
    assert result.refusal_category == "TREND_INTERPRETATION"


@pytest.mark.asyncio
async def test_refusal_out_of_scope():
    result = await build_refusal(
        question="Show all patients.",
        category="OUT_OF_SCOPE",
        patient_id="00000000-0000-0000-0000-000000000001",
        language="en",
        pool=None,
    )
    assert "currently selected patient" in result.text.lower() or "patient" in result.text.lower()


@pytest.mark.asyncio
async def test_refusal_unknown_category_falls_back():
    """Unknown category falls back to OTHER_INTERPRETIVE."""
    result = await build_refusal(
        question="Some weird question.",
        category="SOME_UNKNOWN_CATEGORY",
        patient_id="00000000-0000-0000-0000-000000000001",
        language="en",
        pool=None,
    )
    assert result.text
    assert result.refusal_category == "OTHER_INTERPRETIVE"


@pytest.mark.asyncio
async def test_refusal_text_no_interpretive_language():
    """All refusal texts must not contain key interpretive words."""
    interpretive_words = ["worsening", "improving", "trending", "deteriorating",
                          "suggests", "indicates", "consider", "recommend",
                          "diagnose", "prognosis"]
    for category in ALL_CATEGORIES:
        result = await build_refusal(
            question="test",
            category=category,
            patient_id="00000000-0000-0000-0000-000000000001",
            language="en",
            pool=None,
        )
        text_lower = result.text.lower()
        for word in interpretive_words:
            assert word not in text_lower, (
                f"Category {category} refusal text contains interpretive word '{word}': {result.text[:200]}"
            )
