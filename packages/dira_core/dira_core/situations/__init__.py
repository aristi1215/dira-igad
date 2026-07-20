"""Situation lifecycle state machine (DIRA-SPEC §3.1). Pure — no I/O."""

from __future__ import annotations

from enum import StrEnum


class SituationStatus(StrEnum):
    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


ALLOWED_TRANSITIONS: dict[SituationStatus, frozenset[SituationStatus]] = {
    SituationStatus.OPEN: frozenset(
        {SituationStatus.RESOLVED, SituationStatus.DISMISSED}
    ),
    SituationStatus.RESOLVED: frozenset(),
    SituationStatus.DISMISSED: frozenset(),
}


class InvalidTransition(Exception):
    """Raised when a situation status transition is not allowed."""

    def __init__(self, current: SituationStatus, target: SituationStatus) -> None:
        self.current = current
        self.target = target
        super().__init__(f"Invalid situation transition: {current} → {target}")


def can_transition(current: SituationStatus, target: SituationStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


def transition(current: SituationStatus, target: SituationStatus) -> SituationStatus:
    if not can_transition(current, target):
        raise InvalidTransition(current, target)
    return target
