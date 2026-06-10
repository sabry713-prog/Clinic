"""Indexer — upserts patient chunks into the hospital.retrieval_chunk table."""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from .embedder import EmbeddingProvider
from .types import Chunk

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO hospital.retrieval_chunk
    (patient_id, source_type, source_id, chunk_index, language, content_text, embedding)
VALUES
    ($1, $2, $3, $4, $5, $6, $7::vector)
ON CONFLICT (patient_id, source_type, source_id, chunk_index, language)
DO UPDATE SET
    content_text = EXCLUDED.content_text,
    embedding    = EXCLUDED.embedding,
    updated_at   = now()
RETURNING id
"""


async def index_patient_chunks(
    patient_id: str,
    chunks: list[Chunk],
    pool: "asyncpg.Pool[asyncpg.Record]",
    embedder: EmbeddingProvider,
    batch_size: int = 64,
) -> int:
    """Embed and upsert *chunks* for *patient_id*.

    Returns the number of rows upserted.
    """
    if not chunks:
        return 0

    upserted = 0
    texts = [c.content_text for c in chunks]

    # Embed in batches to respect model token limits
    all_vectors: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        vecs = await embedder.embed(batch)
        all_vectors.extend(vecs)

    async with pool.acquire() as conn:
        for chunk, vec in zip(chunks, all_vectors):
            # pgvector expects a string like "[0.1,0.2,...]"
            vec_str = "[" + ",".join(str(v) for v in vec) + "]"
            await conn.fetchrow(
                _UPSERT_SQL,
                patient_id,
                chunk.source_type,
                chunk.source_id,
                chunk.chunk_index,
                chunk.language,
                chunk.content_text,
                vec_str,
            )
            upserted += 1

    logger.info(
        "chunks_indexed",
        extra={
            "patient_id": patient_id,
            "chunks_upserted": upserted,
        },
    )
    return upserted
