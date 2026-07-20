"""Alert approval invariants and delivery idempotency helpers.

Do-not-harm: alert copy must never name actors, ethnicities, clans, or
specific communities — conditions and actions only (CEWARN-aligned).
"""

from __future__ import annotations

from enum import StrEnum


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


# Placeholder — implement idempotency_key hashing and do-not-harm checks here.
DO_NOT_HARM_FORBIDDEN_CATEGORIES = (
    "named_actors",
    "ethnicities",
    "clans",
    "specific_communities",
)
