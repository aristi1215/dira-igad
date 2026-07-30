from __future__ import annotations

import math

from dira_llm import PrecomputedEmbeddingsAdapter


def test_precomputed_embeddings_are_stable_normalized_and_fixed_width() -> None:
    first = PrecomputedEmbeddingsAdapter()
    second = PrecomputedEmbeddingsAdapter()
    vector_a = first.embed(["same seeded text"])[0]
    vector_b = second.embed(["same seeded text"])[0]

    assert vector_a == vector_b
    assert len(vector_a) == 1024
    assert math.isclose(math.sqrt(sum(value * value for value in vector_a)), 1.0, rel_tol=1e-6)
