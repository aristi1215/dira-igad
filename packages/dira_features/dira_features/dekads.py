"""Pure dekad calendar utilities (day 1/11/21 grain). No I/O."""

from __future__ import annotations

import math
from datetime import date, timedelta


def dekad_end(d: date) -> date:
    """Last day of the dekad starting at ``d`` (third dekad runs to month end)."""
    if d.day == 1:
        return d.replace(day=10)
    if d.day == 11:
        return d.replace(day=20)
    if d.month == 12:
        return date(d.year, 12, 31)
    return date(d.year, d.month + 1, 1) - timedelta(days=1)


def next_dekad(d: date) -> date:
    if d.day == 1:
        return d.replace(day=11)
    if d.day == 11:
        return d.replace(day=21)
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def enumerate_dekads(start: date, end: date) -> list[date]:
    """All dekad starts in [start, end], inclusive."""
    out: list[date] = []
    cur = date(start.year, start.month, 1 if start.day <= 1 else (11 if start.day <= 11 else 21))
    while cur <= end:
        if cur >= start:
            out.append(cur)
        cur = next_dekad(cur)
    return out


def dekad_of_year_index(d: date) -> int:
    """0..35 index of the dekad within its year (for seasonality)."""
    return (d.month - 1) * 3 + {1: 0, 11: 1, 21: 2}[d.day]


def seasonality(d: date) -> tuple[float, float]:
    """(sin, cos) of the dekad-of-year phase — captures the bimodal rain seasons."""
    phase = 2 * math.pi * dekad_of_year_index(d) / 36.0
    return math.sin(phase), math.cos(phase)
