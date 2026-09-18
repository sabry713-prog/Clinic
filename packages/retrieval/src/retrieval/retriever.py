"""Retrieval — deterministic lexical (BM25) and hybrid vector + BM25 search.

Both arms read ``hospital.retrieval_chunk``, whose ``source_id`` is the
**immutable id of the source row** (not the patient), so a returned chunk can
be dereferenced back to the fact that produced it.

Ordering is deterministic in every arm: the SQL orders by score with the chunk
id as the final tie-break, and the fusion sort uses the same tie-break.  A
relevance list that reshuffles between two identical calls cannot be
reproduced, compared or cited, so ties are broken by id rather than by
whatever the planner returned.

Vector ranking is gated on an **evaluated** embedding model: the stub's
ordering is arbitrary, so ``hybrid_retrieve`` refuses it (M10).  Until such a
model is provisioned, Q&A runs ``lexical_retrieve`` — retained deliberately,
per the M10 recommendation.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .embedder import EmbeddingProvider, UnevaluatedEmbedderError
from .types import RetrievalResult

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

_VECTOR_SQL = """
SELECT
    id::text,
    content_text,
    source_type,
    source_id::text,
    1 - (embedding <=> $3::vector) AS score
FROM hospital.retrieval_chunk
WHERE patient_id = $1
  AND language   = $2
  AND embedding IS NOT NULL
ORDER BY embedding <=> $3::vector, id
LIMIT 20
"""

_BM25_SQL = """
SELECT
    id::text,
    content_text,
    source_type,
    source_id::text,
    ts_rank(
        to_tsvector('simple', content_text),
        plainto_tsquery('simple', $3)
    ) AS score
FROM hospital.retrieval_chunk
WHERE patient_id = $1
  AND language   = $2
  AND to_tsvector('simple', content_text) @@ plainto_tsquery('simple', $3)
ORDER BY
    ts_rank(
        to_tsvector('simple', content_text),
        plainto_tsquery('simple', $3)
    ) DESC,
    id
LIMIT 20
"""

_RRF_K = 60


def _rrf_fuse(
    vector_rows: list[dict[str, object]],
    bm25_rows: list[dict[str, object]],
    top_k: int,
    language: str = "en",
) -> list[RetrievalResult]:
    """Reciprocal Rank Fusion: score = 1/(k+rank_v) + 1/(k+rank_b).

    Ties are broken by chunk id so the fused order is total and stable: two
    calls over the same rows return the same list, in the same order.
    """
    scores: dict[str, float] = {}
    vector_rank: dict[str, int] = {}
    bm25_rank: dict[str, int] = {}

    for rank, row in enumerate(vector_rows, start=1):
        cid = str(row["id"])
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (_RRF_K + rank)
        vector_rank[cid] = rank

    for rank, row in enumerate(bm25_rows, start=1):
        cid = str(row["id"])
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (_RRF_K + rank)
        bm25_rank[cid] = rank

    # Build a mapping from id to row data (prefer vector rows; supplement BM25)
    row_data: dict[str, dict[str, object]] = {}
    for row in vector_rows:
        row_data[str(row["id"])] = dict(row)
    for row in bm25_rows:
        cid = str(row["id"])
        if cid not in row_data:
            row_data[cid] = dict(row)

    sorted_ids = sorted(scores, key=lambda cid: (-scores[cid], cid))[:top_k]

    return [
        RetrievalResult(
            chunk_id=cid,
            source_type=str(row_data[cid]["source_type"]),
            source_id=str(row_data[cid]["source_id"]),
            content_text=str(row_data[cid]["content_text"]),
            score=scores[cid],
            vector_rank=vector_rank.get(cid),
            bm25_rank=bm25_rank.get(cid),
            language=language,
        )
        for cid in sorted_ids
    ]


async def lexical_retrieve(
    patient_id: str,
    query: str,
    pool: "asyncpg.Pool[asyncpg.Record]",
    top_k: int = 8,
    language: str = "en",
) -> list[RetrievalResult]:
    """BM25 (tsvector) retrieval over the patient's index.

    This is the arm that runs today: it needs no model, and its ranking is
    reproducible from the stored text alone.
    """
    async with pool.acquire() as conn:
        bm25_records = await conn.fetch(_BM25_SQL, patient_id, language, query)

    bm25_rows = [dict(r) for r in bm25_records]
    results = _rrf_fuse([], bm25_rows, top_k=top_k, language=language)

    logger.debug(
        "lexical_retrieve_done",
        extra={
            "patient_id": patient_id,
            "bm25_hits": len(bm25_rows),
            "returned": len(results),
        },
    )
    return results


async def hybrid_retrieve(
    patient_id: str,
    query: str,
    pool: "asyncpg.Pool[asyncpg.Record]",
    embedder: EmbeddingProvider,
    top_k: int = 8,
    language: str = "en",
) -> list[RetrievalResult]:
    """Run hybrid vector + BM25 retrieval and return top-k fused results.

    Parameters
    ----------
    patient_id:
        UUID of the patient whose chunks to search.
    query:
        Natural-language query string.
    pool:
        asyncpg connection pool.
    embedder:
        EmbeddingProvider to embed the query.  Must be an **evaluated** model:
        an unevaluated one (the stub) raises instead of contributing an
        arbitrary ordering to the fusion.
    top_k:
        Number of results to return after fusion.
    language:
        ``"en"`` or ``"ar"`` — filters to chunks of this language.
    """
    if not embedder.is_evaluated():
        raise UnevaluatedEmbedderError(
            f"hybrid_retrieve refuses unevaluated embedder {embedder.model_id()!r}: "
            "its vector ordering has not been measured against a labelled "
            "clinical set, so it cannot be presented as relevance. Use "
            "lexical_retrieve, or provision an evaluated model."
        )

    [query_vector] = await embedder.embed([query])
    vec_str = "[" + ",".join(str(v) for v in query_vector) + "]"

    async with pool.acquire() as conn:
        vector_records = await conn.fetch(_VECTOR_SQL, patient_id, language, vec_str)
        bm25_records = await conn.fetch(_BM25_SQL, patient_id, language, query)

    vector_rows = [dict(r) for r in vector_records]
    bm25_rows = [dict(r) for r in bm25_records]

    results = _rrf_fuse(vector_rows, bm25_rows, top_k=top_k, language=language)

    logger.debug(
        "hybrid_retrieve_done",
        extra={
            "patient_id": patient_id,
            "vector_hits": len(vector_rows),
            "bm25_hits": len(bm25_rows),
            "fused_returned": len(results),
            "embedding_model": embedder.model_id(),
        },
    )
    return results
