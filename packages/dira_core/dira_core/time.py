"""Dekadal calendar helpers — pure, no I/O."""

from __future__ import annotations

import calendar
from datetime import date, timedelta


class InvalidDekad(ValueError):
    """Raised when a date is not a valid dekad start (day 1, 11, or 21)."""


def validate_dekad_start(d: date) -> date:
    if d.day not in (1, 11, 21):
        raise InvalidDekad(
            f"Cycle date must be a dekad start (day 1, 11, or 21); got {d.isoformat()}"
        )
    return d


def dekad_end(dekad_start: date) -> date:
    """Inclusive end date of the dekad (February day-21 → month end)."""
    validate_dekad_start(dekad_start)
    if dekad_start.day == 1:
        return date(dekad_start.year, dekad_start.month, 10)
    if dekad_start.day == 11:
        return date(dekad_start.year, dekad_start.month, 20)
    last = calendar.monthrange(dekad_start.year, dekad_start.month)[1]
    return date(dekad_start.year, dekad_start.month, last)


def previous_dekad(dekad_start: date) -> date:
    validate_dekad_start(dekad_start)
    if dekad_start.day == 21:
        return date(dekad_start.year, dekad_start.month, 11)
    if dekad_start.day == 11:
        return date(dekad_start.year, dekad_start.month, 1)
    # day == 1 → previous month day 21
    if dekad_start.month == 1:
        return date(dekad_start.year - 1, 12, 21)
    return date(dekad_start.year, dekad_start.month - 1, 21)


def next_dekad(dekad_start: date) -> date:
    validate_dekad_start(dekad_start)
    if dekad_start.day == 1:
        return date(dekad_start.year, dekad_start.month, 11)
    if dekad_start.day == 11:
        return date(dekad_start.year, dekad_start.month, 21)
    # day == 21 → next month day 1
    if dekad_start.month == 12:
        return date(dekad_start.year + 1, 1, 1)
    return date(dekad_start.year, dekad_start.month + 1, 1)


def iter_dekads(start: date, end: date) -> list[date]:
    """Inclusive list of dekad starts from start..end."""
    validate_dekad_start(start)
    validate_dekad_start(end)
    out: list[date] = []
    cur = start
    # Safety bound: ~3 dekads/month * 12 * 50 years
    for _ in range(2000):
        out.append(cur)
        if cur >= end:
            break
        cur = next_dekad(cur)
    return out


def data_cutoff_for_cycle(cycle: date) -> date:
    """Default bitemporal cutoff: end of the cycle dekad (inclusive calendar day)."""
    return dekad_end(cycle)


# Backoff schedule for dispatch retries (minutes): 1, 5, 25, 120.
DISPATCH_BACKOFF_MINUTES: tuple[int, ...] = (1, 5, 25, 120)


def dispatch_backoff_delta(attempt_count: int) -> timedelta:
    """attempt_count is the count AFTER the failed attempt (1-based)."""
    idx = max(0, min(attempt_count - 1, len(DISPATCH_BACKOFF_MINUTES) - 1))
    return timedelta(minutes=DISPATCH_BACKOFF_MINUTES[idx])
