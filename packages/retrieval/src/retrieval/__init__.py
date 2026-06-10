"""Retrieval package — chunking, embedding, and hybrid retrieval.

Public surface::

    from retrieval.chunker import chunk_patient_record
    from retrieval.embedder import EmbeddingProvider, StubEmbeddingProvider
    from retrieval.indexer import index_patient_chunks
    from retrieval.retriever import hybrid_retrieve
    from retrieval.types import Chunk, RetrievalResult, SourceRef, PatientChunkInput
"""
from __future__ import annotations

from .chunker import chunk_patient_record
from .embedder import EmbeddingProvider, StubEmbeddingProvider
from .indexer import index_patient_chunks
from .retriever import hybrid_retrieve
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
    "index_patient_chunks",
    "hybrid_retrieve",
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
