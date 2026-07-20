"""Alert invariants (invariant 1 & 4). Pure: the DB CHECK is the enforcement of the human
gate; this module gives the domain the same rule and the deterministic idempotency key so
callers never diverge from the schema."""

from __future__ import annotations

import hashlib

from dira_core.enums import AlertStatus, Channel
from dira_core.errors import HumanGateViolation

# Alert states that physically reach dispatch. Each requires a human approver.
_DISPATCHABLE = frozenset(
    {AlertStatus.APPROVED, AlertStatus.DISPATCHING, AlertStatus.DISPATCHED}
)


def derive_idempotency_key(alert_id: str, recipient_id: str, channel: str | Channel) -> str:
    """Deterministic key = sha256("alert_id:recipient_id:channel").

    Guarantees our system never creates two deliveries for the same triple (invariant 4).
    """
    ch = channel.value if isinstance(channel, Channel) else channel
    raw = f"{alert_id}:{recipient_id}:{ch}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def ensure_approvable(
    target_status: AlertStatus,
    *,
    approved_by: str | None,
    approved_at: object | None,
) -> None:
    """Raise :class:`HumanGateViolation` if a dispatchable status lacks a human approver.

    Mirrors the DB CHECK exactly (invariant 1). Never disabled — tests use the real flow.
    """
    if target_status in _DISPATCHABLE and (approved_by is None or approved_at is None):
        raise HumanGateViolation(
            f"alert cannot become {target_status.value} without approved_by and approved_at"
        )
