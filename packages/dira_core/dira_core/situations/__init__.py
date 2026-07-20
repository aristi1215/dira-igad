"""Situation lifecycle, state machine, and human gate invariants.

Implementation agent: encode transitions detected → assessed → proposed →
approved → dispatching → dispatched → acknowledged → resolved|dismissed.
Human approval is enforced by a DB CHECK, not only by code convention.
"""

from __future__ import annotations

from enum import StrEnum


class SituationStatus(StrEnum):
    DETECTED = "detected"
    ASSESSED = "assessed"
    PROPOSED = "proposed"
    APPROVED = "approved"
    DISPATCHING = "dispatching"
    DISPATCHED = "dispatched"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


# Placeholder — implement pure transition validation here (no I/O).
ALLOWED_TRANSITIONS: dict[SituationStatus, frozenset[SituationStatus]] = {}
