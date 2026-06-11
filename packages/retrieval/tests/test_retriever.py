"""Tests for the hybrid retriever and RRF fusion logic."""
from __future__ import annotations

import pytest

from retrieval.retriever import _rrf_fuse


# ── RRF fusion unit tests ─────────────────────────────────────────────────────

def _make_row(id_: str, text: str = "text") -> dict[str, object]:
    return {
        "id": id_,
        "content_text": text,
        "source_type": "Observation",
        "source_id": id_,
        "score": 0.9,
    }


def test_rrf_fuse_combined_ranks() -> None:
    vector_rows = [_make_row("a"), _make_row("b"), _make_row("c")]
    bm25_rows = [_make_row("b"), _make_row("c"), _make_row("d")]
    results = _rrf_fuse(vector_rows, bm25_rows, top_k=4)
    ids = [r.chunk_id for r in results]
    # b and c appear in both → should be top-ranked
    assert ids[0] in ("b", "c")
    assert ids[1] in ("b", "c")


def test_rrf_fuse_top_k_respected() -> None:
    vector_rows = [_make_row(str(i)) for i in range(10)]
    bm25_rows = []
    results = _rrf_fuse(vector_rows, bm25_rows, top_k=3)
    assert len(results) == 3


def test_rrf_fuse_empty_bm25() -> None:
    vector_rows = [_make_row("x"), _make_row("y")]
    results = _rrf_fuse(vector_rows, [], top_k=5)
    assert len(results) == 2
    assert results[0].chunk_id == "x"  # rank 1 → highest score


def test_rrf_fuse_empty_vector() -> None:
    bm25_rows = [_make_row("p"), _make_row("q")]
    results = _rrf_fuse([], bm25_rows, top_k=5)
    assert len(results) == 2


def test_rrf_fuse_all_empty() -> None:
    results = _rrf_fuse([], [], top_k=8)
    assert results == []


def test_rrf_fuse_sets_language() -> None:
    results = _rrf_fuse([_make_row("a")], [], top_k=1, language="ar")
    assert results[0].language == "ar"
    assert results[0].effective_at is None


def test_rrf_fuse_language_defaults_to_en() -> None:
    results = _rrf_fuse([_make_row("a")], [], top_k=1)
    assert results[0].language == "en"


def test_rrf_result_has_rank_fields() -> None:
    vector_rows = [_make_row("a"), _make_row("b")]
    bm25_rows = [_make_row("a")]
    results = _rrf_fuse(vector_rows, bm25_rows, top_k=2)
    a_result = next(r for r in results if r.chunk_id == "a")
    assert a_result.vector_rank == 1
    assert a_result.bm25_rank == 1
    b_result = next(r for r in results if r.chunk_id == "b")
    assert b_result.vector_rank == 2
    assert b_result.bm25_rank is None


# ── StubEmbeddingProvider tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stub_embedder_dimension() -> None:
    from retrieval.embedder import StubEmbeddingProvider
    provider = StubEmbeddingProvider()
    assert provider.dimension() == 1024


@pytest.mark.asyncio
async def test_stub_embedder_returns_unit_vectors() -> None:
    import math
    from retrieval.embedder import StubEmbeddingProvider
    provider = StubEmbeddingProvider()
    vecs = await provider.embed(["hello world", "creatinine 168"])
    assert len(vecs) == 2
    for vec in vecs:
        assert len(vec) == 1024
        norm = math.sqrt(sum(v * v for v in vec))
        assert abs(norm - 1.0) < 1e-5


@pytest.mark.asyncio
async def test_stub_embedder_deterministic() -> None:
    from retrieval.embedder import StubEmbeddingProvider
    provider = StubEmbeddingProvider()
    vecs1 = await provider.embed(["test text"])
    vecs2 = await provider.embed(["test text"])
    assert vecs1 == vecs2


@pytest.mark.asyncio
async def test_stub_embedder_different_texts_differ() -> None:
    from retrieval.embedder import StubEmbeddingProvider
    provider = StubEmbeddingProvider()
    vecs = await provider.embed(["text A", "text B"])
    assert vecs[0] != vecs[1]
