"""Indexer — writes a patient's chunks into ``hospital.retrieval_chunk``.

M10: the write is a **replacement**, not an accumulation, and it is atomic.

- One transaction covers the whole patient, so a reader never sees a patient
  half-indexed.
- Chunks whose source row no longer exists are deleted in the same
  transaction.  Without that pass a corrected or withdrawn fact keeps being
  retrieved and cited: an upsert can add and update, but it cannot know that
  something disappeared.
- The returned counts come from the affected rows, not from a counter the
  writer increments, so the number reported is the number of rows the
  database actually changed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .embedder import EmbeddingProvider, UnevaluatedEmbedderError
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

# Delete every chunk of this patient whose (source_type, source_id) is not in
# the set being written now. `record_ids`/`source_types` are parallel arrays,
# so the pair comparison is positional: a chunk is stale when no written chunk
# names the same source row.
_DELETE_STALE_SQL = """
DELETE FROM hospital.retrieval_chunk
WHERE patient_id = $1
  AND NOT EXISTS (
        SELECT 1
        FROM unnest($2::text[], $3::uuid[]) AS keep(source_type, source_id)
        WHERE keep.source_type = retrieval_chunk.source_type
          AND keep.source_id   = retrieval_chunk.source_id
      )
RETURNING id
"""

_DELETE_ALL_SQL = """
DELETE FROM hospital.retrieval_chunk
WHERE patient_id = $1
RETURNING id
"""


@dataclass(frozen=True)
class IndexResult:
    """What an index replacement actually changed in the database."""

    upserted: int
    deleted: int
    embedding_model: str = "none"


async def index_patient_chunks(
    patient_id: str,
    chunks: list[Chunk],
    pool: "asyncpg.Pool[asyncpg.Record]",
    embedder: EmbeddingProvider | None = None,
    batch_size: int = 64,
) -> IndexResult:
    """Replace *patient_id*'s chunks with *chunks*, atomically.

    Embeds the texts first (outside the transaction — a model call must not
    hold a database transaction open), then writes every row and deletes the
    stale ones in a single transaction.

    ``embedder=None`` writes lexical-only rows (``embedding`` stays NULL),
    which is the current development posture; a vector arm requires an
    **evaluated** model and an unevaluated one is refused rather than used to
    fill the column with vectors nothing can rank.
    """
    if embedder is not None and not embedder.is_evaluated():
        raise UnevaluatedEmbedderError(
            f"index_patient_chunks refuses to embed with unevaluated provider "
            f"{embedder.model_id()!r}: stored vectors would be unrankable, and "
            "nothing could tell them apart from evaluated ones later. Index "
            "lexically (embedder=None) until an evaluated model exists."
        )

    texts = [c.content_text for c in chunks]
    vectors: list[list[float] | None] = [None] * len(texts)
    if embedder is not None and texts:
        embedded: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            embedded.extend(await embedder.embed(texts[i : i + batch_size]))
        vectors = list(embedded)

    upserted = 0
    deleted = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            for chunk, vec in zip(chunks, vectors):
                vec_str = (
                    "[" + ",".join(str(v) for v in vec) + "]" if vec is not None else None
                )
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

            if chunks:
                source_types = [c.source_type for c in chunks]
                record_ids = [c.source_id for c in chunks]
                stale = await conn.fetch(_DELETE_STALE_SQL, patient_id, source_types, record_ids)
            else:
                stale = await conn.fetch(_DELETE_ALL_SQL, patient_id)
            deleted = len(stale)

    logger.info(
        "index_replacement",
        extra={
            "patient_id": patient_id,
            "rows_written": upserted,
            "rows_deleted": deleted,
            "embedding_model": embedder.model_id() if embedder is not None else "none",
        },
    )
    return IndexResult(
        upserted=upserted,
        deleted=deleted,
        embedding_model=embedder.model_id() if embedder is not None else "none",
    )
