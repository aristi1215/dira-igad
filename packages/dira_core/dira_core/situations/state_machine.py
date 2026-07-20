"""Situation state machine (DIRA-SPEC.md §4.1). Pure: no I/O, no clock.

Hysteresis lives here as a decision function so training/inference/pipeline all agree on when
a situation opens, keeps monitoring, resolves or stays put — never by ad-hoc SQL.
"""

from __future__ import annotations

from enum import StrEnum

from dira_core.enums import RiskBand, SituationStatus
from dira_core.errors import InvalidTransition

# Exact allowed transitions. Anything not listed is a domain error.
_ALLOWED: dict[SituationStatus, frozenset[SituationStatus]] = {
    SituationStatus.OPEN: frozenset(
        {SituationStatus.MONITORING, SituationStatus.RESOLVED, SituationStatus.DISMISSED}
    ),
    SituationStatus.MONITORING: frozenset(
        {SituationStatus.OPEN, SituationStatus.RESOLVED, SituationStatus.DISMISSED}
    ),
    SituationStatus.RESOLVED: frozenset(),  # terminal
    SituationStatus.DISMISSED: frozenset(),  # terminal
}


def is_terminal(status: SituationStatus) -> bool:
    return status in (SituationStatus.RESOLVED, SituationStatus.DISMISSED)


def transition(current: SituationStatus, target: SituationStatus) -> SituationStatus:
    """Return ``target`` if the transition is allowed, else raise :class:`InvalidTransition`."""
    if target not in _ALLOWED[current]:
        raise InvalidTransition(f"{current.value} -> {target.value} is not permitted")
    return target


class SituationDecision(StrEnum):
    """The verdict for a situation given a new cycle's operational band."""

    OPEN = "open"          # cross the high threshold: open or re-open (monitoring -> open)
    MONITOR = "monitor"    # below high but not yet resolvable: keep watching
    RESOLVE = "resolve"    # enough consecutive low cycles: resolve
    HOLD = "hold"          # no situation warranted (band below high, none open)


def decide_situation(
    *,
    operational_band: RiskBand,
    current_status: SituationStatus | None,
    cycles_below_threshold: int,
    high_band: RiskBand = RiskBand.ORANGE,
    low_band: RiskBand = RiskBand.YELLOW,
    resolve_after_cycles_below: int = 3,
) -> tuple[SituationDecision, int]:
    """Decide what to do with a situation this cycle, plus the new below-threshold counter.

    Hysteresis (avoids flapping): open at/above ``high_band``; resolve only after
    ``resolve_after_cycles_below`` consecutive cycles strictly below ``low_band``.
    """
    at_or_above_high = operational_band.rank >= high_band.rank
    below_low = operational_band.rank < low_band.rank

    if current_status is None or is_terminal(current_status):
        # No live situation: open a fresh one only when we cross the high threshold.
        return (SituationDecision.OPEN if at_or_above_high else SituationDecision.HOLD, 0)

    # A live (open/monitoring) situation exists.
    if at_or_above_high:
        return (SituationDecision.OPEN, 0)  # re-assert / promote to open, reset counter
    if below_low:
        new_count = cycles_below_threshold + 1
        if new_count >= resolve_after_cycles_below:
            return (SituationDecision.RESOLVE, new_count)
        return (SituationDecision.MONITOR, new_count)
    # Between low and high: keep monitoring but do not accrue toward resolution.
    return (SituationDecision.MONITOR, 0)
