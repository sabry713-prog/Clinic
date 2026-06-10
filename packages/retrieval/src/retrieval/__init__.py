"""
Retrieval package.

Slice 0 stub — returns empty chunk list.
Real implementation ships in Slice 2.
"""
from __future__ import annotations

from pydantic import BaseModel


class RetrievalChunk(BaseModel):
    source_type: str
    source_id: str
    content_text: str
    score: float


def retrieve(
    patient_id: str,
    query: str,
    language: str = "ar",
    top_k: int = 10,
) -> list[RetrievalChunk]:
    """Stub retrieval — returns empty list. Replace in Slice 2."""
    return []
