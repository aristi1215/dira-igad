"""Cycle validation and the bitemporal data cutoff (deterministic; no now())."""

from __future__ import annotations

from datetime import UTC, date, datetime


class InvalidCycle(ValueError):
    """The requested cycle is not a valid dekad start (day must be 1, 11 or 21)."""


def parse_cycle(value: str) -> date:
    """Parse and validate a cycle date string; reject non-dekadal days clearly."""
    try:
        d = date.fromisoformat(value)
    except ValueError as exc:
        raise InvalidCycle(f"cycle must be YYYY-MM-DD, got {value!r}") from exc
    if d.day not in (1, 11, 21):
        raise InvalidCycle(f"cycle day must be 1, 11 or 21 (dekadal grain), got {value}")
    return d


def data_cutoff(cycle: date) -> datetime:
    """The instant up to which observations are visible for this cycle.

    Deterministic: 00:00 UTC of the cycle's dekad start. Every variable is built only from
    values whose ``available_at <= data_cutoff`` (invariant 2). The current dekad's climate
    (published a few days after the dekad ends) is therefore correctly excluded at prediction
    time — no leakage.
    """
    return datetime(cycle.year, cycle.month, cycle.day, tzinfo=UTC)
