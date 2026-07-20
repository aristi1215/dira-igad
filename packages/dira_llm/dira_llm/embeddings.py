"""Embedding adapters with deterministic no-network fallback."""

from __future__ import annotations

import hashlib
import math

EMBEDDING_DIM = 1024


class PrecomputedEmbeddingsAdapter:
    """Return zero or hash-derived vectors for seeded mode."""

    def __init__(self, *, hash_based: bool = True, dimensions: int = EMBEDDING_DIM) -> None:
        self.hash_based = hash_based
        self.dimensions = dimensions

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self.hash_based:
            return [[0.0] * self.dimensions for _ in texts]
        return [_hash_embedding(text, self.dimensions) for text in texts]


class LocalBgeM3Adapter:
    """Placeholder for local BGE-M3; currently falls back deterministically."""

    def __init__(self, fallback: PrecomputedEmbeddingsAdapter | None = None) -> None:
        self.fallback = fallback or PrecomputedEmbeddingsAdapter()

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self.fallback.embed(texts)


def _hash_embedding(text: str, dimensions: int) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values: list[float] = []
    counter = 0
    while len(values) < dimensions:
        block = hashlib.sha256(digest + counter.to_bytes(4, "big")).digest()
        values.extend((byte / 127.5) - 1.0 for byte in block)
        counter += 1
    vector = values[:dimensions]
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0.0:
        return vector
    return [value / norm for value in vector]
