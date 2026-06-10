"""End-to-end classify() tests."""
from __future__ import annotations

import pytest
from classifier import classify, ClassifierResult


@pytest.mark.asyncio
async def test_allowed_factual():
    result = await classify("What is the last creatinine?")
    assert result.label == "ALLOWED"
    assert result.layer == "rule"


@pytest.mark.asyncio
async def test_refused_trend():
    result = await classify("Is his creatinine getting worse?")
    assert result.label == "REFUSED"
    assert result.refusal_category == "TREND_INTERPRETATION"
    assert result.layer == "rule"


@pytest.mark.asyncio
async def test_refused_diagnostic():
    result = await classify("Could this be sepsis?")
    assert result.label == "REFUSED"
    assert result.refusal_category == "DIAGNOSTIC_SUGGESTION"


@pytest.mark.asyncio
async def test_refused_out_of_scope():
    result = await classify("Show me all patients with diabetes.")
    assert result.label == "REFUSED"
    assert result.refusal_category == "OUT_OF_SCOPE"


@pytest.mark.asyncio
async def test_allowed_admitting_diagnosis():
    result = await classify("What is the admitting diagnosis?")
    assert result.label == "ALLOWED"


@pytest.mark.asyncio
async def test_refused_has_rule_matches():
    result = await classify("Is the patient's condition worsening?")
    assert result.label == "REFUSED"
    assert len(result.rule_matches) > 0


@pytest.mark.asyncio
async def test_model_fallthrough_empty():
    result = await classify("")
    assert result.label == "REFUSED"
    assert result.refusal_category == "OTHER_INTERPRETIVE"
    assert result.layer == "model"


@pytest.mark.asyncio
async def test_model_fallthrough_factual_question():
    # A question that doesn't hit any rule but is clearly factual
    result = await classify("Display the current vitals.")
    assert result.label == "ALLOWED"


@pytest.mark.asyncio
async def test_arabic_refused():
    result = await classify("هل يتدهور وضعه؟", language="ar")
    assert result.label == "REFUSED"
    assert result.refusal_category == "TREND_INTERPRETATION"


@pytest.mark.asyncio
async def test_quote_stripping():
    # «...» quotes should be stripped before rule matching
    result = await classify("What is «the last» creatinine?")
    # Should still parse as factual
    assert result.label == "ALLOWED"
