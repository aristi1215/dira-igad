"""Domain enums. Values match the DB CHECK vocabularies exactly (DIRA-SPEC.md §4–5)."""

from __future__ import annotations

from enum import StrEnum


class SituationStatus(StrEnum):
    OPEN = "open"
    MONITORING = "monitoring"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class AlertStatus(StrEnum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    DISPATCHING = "dispatching"
    DISPATCHED = "dispatched"
    CANCELLED = "cancelled"


class DeliveryStatus(StrEnum):
    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"


class AckStatus(StrEnum):
    NONE = "none"
    ACKNOWLEDGED = "acknowledged"
    NEED_HELP = "need_help"
    NOT_AFFECTED = "not_affected"


class RiskBand(StrEnum):
    """Ordered bands. Colours: green→yellow→orange→red (the map/demo depends on order)."""

    GREEN = "green"
    YELLOW = "yellow"
    ORANGE = "orange"
    RED = "red"

    @property
    def rank(self) -> int:
        return _BAND_ORDER.index(self)


_BAND_ORDER: list[RiskBand] = [RiskBand.GREEN, RiskBand.YELLOW, RiskBand.ORANGE, RiskBand.RED]


class SignalStatus(StrEnum):
    UNCONFIRMED = "unconfirmed"
    CONFIRMED = "confirmed"
    DISMISSED = "dismissed"


class Channel(StrEnum):
    VOICE = "voice"
    SMS = "sms"
