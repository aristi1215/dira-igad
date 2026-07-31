"""Alert approval invariants and delivery idempotency helpers.

Do-not-harm: alert copy must never name actors, ethnicities, clans, or
specific communities — conditions and actions only (CEWARN-aligned, ADR #20).
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
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
    REJECTED = "rejected"


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


@dataclass(frozen=True)
class AlertVariant:
    """One drafted wording of an alert, for a language and optionally a role."""

    language: str
    body_text: str
    role: str | None = None


def _base_language(code: str) -> str:
    """'sw-KE' and 'sw' are the same language for wording purposes."""
    return code.split("-")[0].lower()


@dataclass(frozen=True)
class ResolvedBody:
    """The text a specific recipient gets, and which rung produced it."""

    body_text: str
    language: str
    role: str | None
    #: Which rung matched: 'language+role', 'language', 'alert-language' or
    #: 'default'.
    matched: str
    #: The language this recipient should have been addressed in.
    requested_language: str

    @property
    def is_fallback(self) -> bool:
        """True only when nobody wrote anything in this recipient's language.

        Deliberately *not* `matched == 'default'`: a Swahili speaker receiving
        the Swahili alert body is being served correctly, even though no variant
        row was involved. Flagging that would mean every fresh alert warns about
        every recipient, and a warning that is always on is not a warning.
        """
        return _base_language(self.language) != _base_language(self.requested_language)


def resolve_alert_body(
    variants: Iterable[AlertVariant],
    *,
    recipient_language: str | None,
    recipient_role: str | None,
    alert_language: str,
    alert_body_text: str,
) -> ResolvedBody:
    """Pick the wording for one recipient.

    Rungs, most specific first:

      1. their language *and* their role
      2. their language, any role
      3. the alert's own language, any role
      4. `alerts.body_text` — the fallback that always exists

    Rung 4 is why nothing breaks when an alert has no variants at all: the
    behaviour is exactly what it was before variants existed.
    """
    pool = list(variants)
    requested = recipient_language or alert_language
    language = _base_language(requested)

    def find(lang: str, role: str | None) -> AlertVariant | None:
        for variant in pool:
            if _base_language(variant.language) != lang:
                continue
            if role is None and variant.role is None:
                return variant
            if role is not None and variant.role == role:
                return variant
        return None

    if recipient_role is not None:
        exact = find(language, recipient_role)
        if exact is not None:
            return ResolvedBody(
                exact.body_text, exact.language, exact.role, "language+role", requested
            )

    any_role = find(language, None)
    if any_role is not None:
        return ResolvedBody(
            any_role.body_text, any_role.language, None, "language", requested
        )

    alert_lang = _base_language(alert_language)
    if alert_lang != language:
        fallback = find(alert_lang, None)
        if fallback is not None:
            return ResolvedBody(
                fallback.body_text, fallback.language, None, "alert-language", requested
            )

    return ResolvedBody(alert_body_text, alert_language, None, "default", requested)


def text_contains_forbidden_terms(text: str, forbidden: list[str]) -> list[str]:
    """Return which forbidden terms appear in text (case-insensitive whole-ish match)."""
    lowered = text.lower()
    hits: list[str] = []
    for term in forbidden:
        t = term.strip().lower()
        if t and t in lowered:
            hits.append(term)
    return hits
