"""Exponential backoff schedule for delivery retries (ADR 15). Pure and deterministic."""

from __future__ import annotations

# 1m, 5m, 25m, 2h — the delay applied AFTER the Nth attempt fails.
BACKOFF_SECONDS: list[int] = [60, 300, 1500, 7200]


def backoff_seconds(attempt: int) -> int:
    """Delay before the next try, given the attempt number that just failed (1-based)."""
    idx = max(0, min(attempt - 1, len(BACKOFF_SECONDS) - 1))
    return BACKOFF_SECONDS[idx]
