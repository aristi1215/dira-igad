"""Simple baseline predictions and metric helpers for model cards."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from datetime import date


def persistence(values: Sequence[float]) -> list[float]:
    """Predict the previous observed value, with the first value as its own baseline."""

    if not values:
        return []
    return [float(values[0]), *[float(value) for value in values[:-1]]]


def climatology(values: Sequence[float], cycles: Sequence[date]) -> list[float]:
    """Predict mean historical value for the same month/dekad slot."""

    if len(values) != len(cycles):
        raise ValueError("values and cycles must have the same length")
    global_mean = mean(values)
    buckets: dict[tuple[int, int], list[float]] = defaultdict(list)
    out: list[float] = []
    for value, cycle in zip(values, cycles, strict=True):
        key = (cycle.month, cycle.day)
        history = buckets[key]
        out.append(mean(history) if history else global_mean)
        history.append(float(value))
    return out


def cast_aggregate(event_counts: Sequence[float], window: int = 3) -> list[float]:
    """CAST-like rolling aggregate over recent conflict counts."""

    if window <= 0:
        raise ValueError("window must be positive")
    out: list[float] = []
    for idx, _ in enumerate(event_counts):
        start = max(0, idx - window)
        history = event_counts[start:idx]
        out.append(mean(history) if history else 0.0)
    return out


def mae(actual: Sequence[float], predicted: Sequence[float]) -> float:
    if len(actual) != len(predicted):
        raise ValueError("actual and predicted must have the same length")
    if not actual:
        return 0.0
    total_error = sum(
        abs(float(a) - float(p)) for a, p in zip(actual, predicted, strict=True)
    )
    return total_error / len(actual)


def brier_score(actual_binary: Sequence[float], predicted_probability: Sequence[float]) -> float:
    if len(actual_binary) != len(predicted_probability):
        raise ValueError("actual and predicted must have the same length")
    if not actual_binary:
        return 0.0
    return sum(
        (float(a) - max(0.0, min(1.0, float(p)))) ** 2
        for a, p in zip(actual_binary, predicted_probability, strict=True)
    ) / len(actual_binary)


def mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return sum(float(value) for value in values) / len(values)
