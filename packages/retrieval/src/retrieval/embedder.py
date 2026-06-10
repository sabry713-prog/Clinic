"""Embedding provider interface and stub implementation.

The EmbeddingProvider protocol is the integration point for real embedding
models (e.g. Cohere multilingual-v3, AraBART).  StubEmbeddingProvider
returns deterministic pseudo-random vectors seeded from the text hash so
that retrieval tests are reproducible without a live model.
"""
from __future__ import annotations

import hashlib
import math
from typing import Protocol, runtime_checkable

import numpy as np


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


class StubEmbeddingProvider:
    """Deterministic pseudo-random embedding provider for testing.

    Hashes each text with SHA-256 to seed a numpy RNG, then draws a
    1024-dimensional unit vector.  The same text always yields the same
    vector; different texts are unlikely to collide.
    """

    def dimension(self) -> int:  # noqa: D102
        return 1024

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
