"""Tests for synthesis pipeline."""
from __future__ import annotations

import pytest
from src.qa.model_client import StubModelProvider
from src.qa.synthesis import build_chunk_fallback, extract_sources, synthesize


SAMPLE_CHUNKS = [
    {
        "source_type": "Observation",
        "source_id": "obs-001",
        "content_text": "Creatinine = 168 μmol/L on 2026-05-24. Reference range: 59-104.",
        "language": "en",
        "effective_at": "2026-05-24",
        "code": "2160-0",
        "source_system": "hospital",
        "field": "value_numeric",
    }
]


@pytest.mark.asyncio
async def test_synthesis_returns_text():
    model = StubModelProvider()
    text, sources, _ = await synthesize(
        question="What is the last creatinine?",
        chunks=SAMPLE_CHUNKS,
        language="en",
        patient_id="00000000-0000-0000-0000-000000000001",
        model=model,
    )
    assert text


@pytest.mark.asyncio
async def test_synthesis_returns_sources():
    model = StubModelProvider()
    text, sources, _ = await synthesize(
        question="What is the last creatinine?",
        chunks=SAMPLE_CHUNKS,
        language="en",
        patient_id="00000000-0000-0000-0000-000000000001",
        model=model,
    )
    assert len(sources) > 0


@pytest.mark.asyncio
async def test_synthesis_empty_chunks():
    model = StubModelProvider()
    text, sources, _ = await synthesize(
        question="What is the last colonoscopy?",
        chunks=[],
        language="en",
        patient_id="00000000-0000-0000-0000-000000000001",
        model=model,
    )
    assert text


def test_chunk_fallback_with_chunks():
    result = build_chunk_fallback(SAMPLE_CHUNKS, "en")
    assert "cannot generate" in result.lower() or "Creatinine" in result


def test_chunk_fallback_empty():
    result = build_chunk_fallback([], "en")
    assert "no matching data" in result.lower()


def test_extract_sources():
    sources = extract_sources("The creatinine was 168 μmol/L.", SAMPLE_CHUNKS)
    assert len(sources) > 0
    assert sources[0].type == "Observation"
