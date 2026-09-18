"""Embedding provider interface and the development stub.

The EmbeddingProvider protocol is the integration point for real embedding
models (e.g. Cohere multilingual-v3, AraBART).  StubEmbeddingProvider
returns deterministic pseudo-random vectors seeded from the text hash so
that retrieval tests are reproducible without a live model.

M10: a provider must say whether it was **evaluated** for retrieval.
`StubEmbeddingProvider` is not: its vectors are seeded from a hash, so a
cosine ordering over them is arbitrary.  Ranked vector retrieval therefore
refuses an unevaluated provider instead of presenting that ordering as
relevance, and `create_embedder()` returns None for the stub so the caller
stays on lexical retrieval until a real, evaluated model is provisioned
(see docs/assessment/PRE_DEMO_READINESS_ASSESSMENT.md, M10).
"""
from __future__ import annotations

import hashlib
from typing import Protocol, runtime_checkable

import numpy as np


class UnevaluatedEmbedderError(RuntimeError):
    """Raised when ranked vector retrieval is asked of an unevaluated model.

    Vector ranking is only meaningful for a model whose retrieval quality has
    been measured (recall@10 on a held-out clinical set).  A stub's ordering
    is arbitrary, and returning it as "the most relevant facts" would be a
    relevance claim that nothing supports.
    """


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Protocol that all embedding backends must satisfy."""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts.

        Returns a list of float vectors, one per input text.
        All vectors have the same dimension as ``self.dimension()``.
        """
        ...

    def dimension(self) -> int:
        """Return the embedding dimension."""
        ...

    def model_id(self) -> str:
        """Return the identity of the model behind the vectors.

        Stored with the index so a re-embedding can be decided from what
        actually produced the stored vectors, not from today's config.
        """
        ...

    def is_evaluated(self) -> bool:
        """True only if this model's retrieval quality has been measured."""
        ...


class StubEmbeddingProvider:
    """Deterministic pseudo-random embedding provider for testing.

    Hashes each text with SHA-256 to seed a numpy RNG, then draws a
    1024-dimensional unit vector.  The same text always yields the same
    vector; different texts are unlikely to collide.

    **Not evaluated for retrieval.**  Use it to exercise index shape and
    storage, never to rank facts for a clinician.
    """

    def dimension(self) -> int:  # noqa: D102
        return 1024

    def model_id(self) -> str:  # noqa: D102
        return "stub-sha256-1024"

    def is_evaluated(self) -> bool:  # noqa: D102
        return False

    async def embed(self, texts: list[str]) -> list[list[float]]:  # noqa: D102
        results: list[list[float]] = []
        for text in texts:
            seed = int(hashlib.sha256(text.encode()).hexdigest(), 16) % (2**32)
            rng = np.random.default_rng(seed)
            vec = rng.standard_normal(self.dimension())
            # L2 normalise
            norm = float(np.linalg.norm(vec))
            if norm > 0:
                vec = vec / norm
            results.append(vec.tolist())
        return results


def create_embedder(provider: str, endpoint: str = "") -> EmbeddingProvider | None:
    """Select the embedding provider from configuration, or None for lexical.

    ``EMBEDDING_MODEL_PROVIDER=stub`` (the development default) returns None:
    lexical retrieval is retained until an evaluated multilingual model is
    provisioned, and no vector arm runs.  An unknown provider raises rather
    than degrading to lexical, so a mistyped or half-configured model name
    cannot quietly turn a hybrid deployment into a keyword one.
    """
    name = (provider or "").strip().lower()
    if name in ("", "stub"):
        return None
    if name in ("none", "lexical"):
        return None
    raise ValueError(
        f"Unknown EMBEDDING_MODEL_PROVIDER {provider!r} (endpoint={endpoint!r}). "
        "Configure a real provider, or set it to 'stub' to run lexical "
        "retrieval only."
    )
