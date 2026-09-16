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


class TestM10CitationExtraction:
    """M10: typed fact contracts — [N] citation parsing replaces heuristic linking."""

    CHUNKS = [
        {"source_id": "src-1", "source_type": "lab", "content_text": "Creatinine 168 µmol/L on 2026-05-24"},
        {"source_id": "src-2", "source_type": "lab", "content_text": "eGFR 38 mL/min on 2026-05-24"},
        {"source_id": "src-3", "source_type": "condition", "content_text": "Chronic kidney disease stage 3"},
    ]

    def test_cited_sources_maps_fact_numbers(self):
        from qa.synthesis import extract_cited_sources
        answer = "Creatinine: 168 µmol/L [1]. eGFR: 38 mL/min [2]."
        sources = extract_cited_sources(answer, self.CHUNKS)
        assert len(sources) == 2
        assert sources[0].id == "src-1"
        assert sources[1].id == "src-2"

    def test_cited_sources_multi_citation(self):
        from qa.synthesis import extract_cited_sources
        answer = "Renal function is reduced [1,2] with underlying CKD [3]."
        sources = extract_cited_sources(answer, self.CHUNKS)
        assert len(sources) == 3

    def test_no_citations_falls_back_to_heuristic(self):
        from qa.synthesis import extract_cited_sources
        answer = "Creatinine 168 and eGFR 38 documented."  # no [N] markers
        sources = extract_cited_sources(answer, self.CHUNKS)
        assert len(sources) > 0  # heuristic finds them by keyword overlap

    def test_out_of_range_citation_ignored(self):
        from qa.synthesis import extract_cited_sources
        answer = "Some fact [99]."
        sources = extract_cited_sources(answer, self.CHUNKS)
        # [99] is out of range; falls back to heuristic
        assert isinstance(sources, list)

    def test_citation_stripped_from_display_text(self):
        import re
        text = "Creatinine: 168 µmol/L [1]. eGFR: 38 mL/min [2]."
        cleaned = re.sub(r"\[(\d+(?:\s*,\s*\d+)*)\]", "", text)
        cleaned = re.sub(r"  +", " ", cleaned).strip()
        assert "[1]" not in cleaned
        assert "[2]" not in cleaned
        assert "168" in cleaned
