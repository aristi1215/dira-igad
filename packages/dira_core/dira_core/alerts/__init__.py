"""Alert approval invariants and delivery idempotency helpers.

Do-not-harm: alert copy must never name actors, ethnicities, clans, or
specific communities — conditions and actions only (CEWARN-aligned, ADR #20).
"""

from __future__ import annotations

import hashlib
import re
from enum import StrEnum


class DomainError(Exception):
    """Domain invariant violation."""


class AlertStatus(StrEnum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    DISPATCHING = "dispatching"
    DISPATCHED = "dispatched"
    FAILED = "failed"


class DispatchStatus(StrEnum):
    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"


class AckStatus(StrEnum):
    NONE = "none"
    ACKNOWLEDGED = "acknowledged"
    CONFLICT_REPORTED = "conflict_reported"
    RESOLVED = "resolved"


# Statuses that require a human signer (mirrors alerts_human_gate_chk).
GATED_ALERT_STATUSES = frozenset(
    {AlertStatus.APPROVED, AlertStatus.DISPATCHING, AlertStatus.DISPATCHED}
)

_E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")

DO_NOT_HARM_FORBIDDEN_CATEGORIES = (
    "named_actors",
    "ethnicities",
    "clans",
    "specific_communities",
)


def derive_idempotency_key(alert_id: str, recipient_id: str, channel: str) -> str:
    """Deterministic sha256 hex of alert_id:recipient_id:channel (invariant 4)."""
    material = f"{alert_id}:{recipient_id}:{channel}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def require_approval_fields(
    status: AlertStatus,
    approved_by: str | None,
    approved_at: object | None,
) -> None:
    """Raise DomainError if gated status lacks signer fields (invariant 1)."""
    if status in GATED_ALERT_STATUSES and (not approved_by or approved_at is None):
        raise DomainError(
            f"Alert status {status} requires approved_by and approved_at"
        )


def validate_e164(phone: str) -> str:
    if not _E164_RE.match(phone):
        raise DomainError(f"Phone must be E.164: {phone!r}")
    return phone


def text_contains_forbidden_terms(text: str, forbidden: list[str]) -> list[str]:
    """Return which forbidden terms appear in text (case-insensitive whole-ish match)."""
    lowered = text.lower()
    hits: list[str] = []
    for term in forbidden:
        t = term.strip().lower()
        if t and t in lowered:
            hits.append(term)
    return hits
