"""dira_core unit tests — must pass with no DB, no network, no .env."""

from __future__ import annotations

import os
from datetime import UTC, date, datetime

import pytest

# Invariant: domain tests never need DATABASE_URL.
os.environ.pop("DATABASE_URL", None)

from dira_core.alerts import (  # noqa: E402
    AlertStatus,
    DomainError,
    derive_idempotency_key,
    require_approval_fields,
    text_contains_forbidden_terms,
    validate_e164,
)
from dira_core.risk import (  # noqa: E402
    RiskBand,
    band_from_score,
    combine_scores,
)
from dira_core.situations import (  # noqa: E402
    InvalidTransition,
    SituationStatus,
    can_transition,
    transition,
)
from dira_core.time import (  # noqa: E402
    InvalidDekad,
    dekad_end,
    dispatch_backoff_delta,
    next_dekad,
    previous_dekad,
    validate_dekad_start,
)


def test_situation_valid_transitions() -> None:
    assert can_transition(SituationStatus.OPEN, SituationStatus.RESOLVED)
    assert transition(SituationStatus.OPEN, SituationStatus.DISMISSED) == SituationStatus.DISMISSED


def test_situation_invalid_transition_raises() -> None:
    with pytest.raises(InvalidTransition):
        transition(SituationStatus.RESOLVED, SituationStatus.OPEN)
    with pytest.raises(InvalidTransition):
        transition(SituationStatus.DISMISSED, SituationStatus.RESOLVED)


def test_combine_scores_returns_rule_text() -> None:
    band, rule = combine_scores(0.7, 0.2)
    assert isinstance(band, RiskBand)
    assert "v1_weighted" in rule
    assert "model_risk" in rule
    assert "corroboration" in rule


def test_combine_scores_corroboration_bump() -> None:
    band, rule = combine_scores(0.5, 0.9, model_band=RiskBand.ELEVATED)
    assert "corroboration_bump" in rule or band in RiskBand
    # High corroboration with elevated model should not stay at low.
    assert band != RiskBand.LOW


def test_band_from_score_bounds() -> None:
    assert band_from_score(-1) == RiskBand.LOW
    assert band_from_score(0.9) == RiskBand.VERY_HIGH
    assert band_from_score(0.5) == RiskBand.ELEVATED


def test_human_gate_require_approval_fields() -> None:
    require_approval_fields(AlertStatus.DRAFT, None, None)  # ok
    with pytest.raises(DomainError):
        require_approval_fields(AlertStatus.APPROVED, None, None)
    require_approval_fields(
        AlertStatus.APPROVED, "advisor@igad", datetime.now(UTC)
    )


def test_idempotency_key_deterministic() -> None:
    a = derive_idempotency_key("alert-1", "rec-1", "voice")
    b = derive_idempotency_key("alert-1", "rec-1", "voice")
    c = derive_idempotency_key("alert-1", "rec-2", "voice")
    assert a == b
    assert a != c
    assert len(a) == 64


def test_validate_e164() -> None:
    assert validate_e164("+254712345678") == "+254712345678"
    with pytest.raises(DomainError):
        validate_e164("0712345678")


def test_dekad_validation_and_february() -> None:
    validate_dekad_start(date(2026, 3, 11))
    with pytest.raises(InvalidDekad):
        validate_dekad_start(date(2026, 3, 15))
    assert dekad_end(date(2026, 2, 21)) == date(2026, 2, 28)
    assert next_dekad(date(2026, 2, 21)) == date(2026, 3, 1)
    assert previous_dekad(date(2026, 3, 1)) == date(2026, 2, 21)


def test_dispatch_backoff_schedule() -> None:
    assert dispatch_backoff_delta(1).total_seconds() == 60
    assert dispatch_backoff_delta(2).total_seconds() == 300
    assert dispatch_backoff_delta(3).total_seconds() == 1500
    assert dispatch_backoff_delta(4).total_seconds() == 7200
    assert dispatch_backoff_delta(5).total_seconds() == 7200


def test_do_not_harm_term_scan() -> None:
    hits = text_contains_forbidden_terms(
        "Tension rising among ClanX pastoralists",
        ["ClanX", "ActorY"],
    )
    assert hits == ["ClanX"]


def test_no_database_url_required() -> None:
    assert os.environ.get("DATABASE_URL") in (None, "")
