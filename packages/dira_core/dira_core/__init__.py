"""Pure domain: situations, risk, alerts, ports. No I/O."""

from __future__ import annotations

from dira_core.alerts import (
    AckStatus,
    AlertStatus,
    DispatchStatus,
    DomainError,
    derive_idempotency_key,
    require_approval_fields,
    validate_e164,
)
from dira_core.risk import (
    COMBINATION_RULE_VERSION,
    RiskBand,
    band_from_score,
    combine_scores,
    score_from_band,
)
from dira_core.situations import (
    ALLOWED_TRANSITIONS,
    InvalidTransition,
    SituationStatus,
    can_transition,
    transition,
)

__all__ = [
    "AckStatus",
    "ALLOWED_TRANSITIONS",
    "AlertStatus",
    "COMBINATION_RULE_VERSION",
    "DispatchStatus",
    "DomainError",
    "InvalidTransition",
    "RiskBand",
    "SituationStatus",
    "band_from_score",
    "can_transition",
    "combine_scores",
    "derive_idempotency_key",
    "require_approval_fields",
    "score_from_band",
    "transition",
    "validate_e164",
]
