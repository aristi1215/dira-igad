"""Dira pure domain package. No I/O, no network, no database."""

from __future__ import annotations

from dira_core.alerts.invariants import derive_idempotency_key, ensure_approvable
from dira_core.enums import (
    AckStatus,
    AlertStatus,
    Channel,
    DeliveryStatus,
    RiskBand,
    SignalStatus,
    SituationStatus,
)
from dira_core.errors import DomainError, HumanGateViolation, InvalidTransition
from dira_core.risk.bands import band_for_score
from dira_core.risk.combination import Combination, combine
from dira_core.situations.state_machine import (
    SituationDecision,
    decide_situation,
    is_terminal,
    transition,
)

__version__ = "0.1.0"

__all__ = [
    "AckStatus",
    "AlertStatus",
    "Channel",
    "Combination",
    "DeliveryStatus",
    "DomainError",
    "HumanGateViolation",
    "InvalidTransition",
    "RiskBand",
    "SignalStatus",
    "SituationDecision",
    "SituationStatus",
    "band_for_score",
    "combine",
    "decide_situation",
    "derive_idempotency_key",
    "ensure_approvable",
    "is_terminal",
    "transition",
]
