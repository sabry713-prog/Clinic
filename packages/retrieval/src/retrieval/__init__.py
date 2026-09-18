"""Retrieval package — chunking, embedding, indexing and retrieval.

Public surface::

    from retrieval.chunker import chunk_patient_record
    from retrieval.embedder import EmbeddingProvider, StubEmbeddingProvider
    from retrieval.embedder import UnevaluatedEmbedderError, create_embedder
    from retrieval.indexer import IndexResult, index_patient_chunks
    from retrieval.retriever import hybrid_retrieve, lexical_retrieve
    from retrieval.types import Chunk, RetrievalResult, SourceRef, PatientChunkInput
"""
from __future__ import annotations

from .chunker import chunk_patient_record
from .embedder import (
    EmbeddingProvider,
    StubEmbeddingProvider,
    UnevaluatedEmbedderError,
    create_embedder,
)
from .indexer import IndexResult, index_patient_chunks
from .retriever import hybrid_retrieve, lexical_retrieve
from .types import (
    AllergyInput,
    Chunk,
    ConditionInput,
    DocumentInput,
    EncounterInput,
    MedicationInput,
    ObservationInput,
    PatientChunkInput,
    RetrievalResult,
    SourceRef,
)

__all__ = [
    "chunk_patient_record",
    "EmbeddingProvider",
    "StubEmbeddingProvider",
    "UnevaluatedEmbedderError",
    "create_embedder",
    "IndexResult",
    "index_patient_chunks",
    "hybrid_retrieve",
    "lexical_retrieve",
    "Chunk",
    "RetrievalResult",
    "SourceRef",
    "PatientChunkInput",
    "ObservationInput",
    "MedicationInput",
    "ConditionInput",
    "AllergyInput",
    "EncounterInput",
    "DocumentInput",
]
