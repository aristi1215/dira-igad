"""M1: pure-domain tests. No DB, no network, no keys (run with empty DATABASE_URL)."""

from __future__ import annotations

import pytest
from dira_core import (
    AlertStatus,
    Channel,
    HumanGateViolation,
    InvalidTransition,
    RiskBand,
    SituationDecision,
    SituationStatus,
    band_for_score,
    combine,
    decide_situation,
    derive_idempotency_key,
    ensure_approvable,
    is_terminal,
    transition,
)


class TestStateMachine:
    def test_valid_transitions(self) -> None:
        S = SituationStatus
        assert transition(S.OPEN, S.MONITORING) is S.MONITORING
        assert transition(S.MONITORING, S.OPEN) is S.OPEN
        assert transition(S.OPEN, S.RESOLVED) is S.RESOLVED
        assert transition(S.MONITORING, S.DISMISSED) is S.DISMISSED

    @pytest.mark.parametrize(
        "src,dst",
        [
            (SituationStatus.RESOLVED, SituationStatus.OPEN),
            (SituationStatus.DISMISSED, SituationStatus.OPEN),
            (SituationStatus.OPEN, SituationStatus.OPEN),
            (SituationStatus.RESOLVED, SituationStatus.DISMISSED),
        ],
    )
    def test_invalid_transitions_raise(self, src: SituationStatus, dst: SituationStatus) -> None:
        with pytest.raises(InvalidTransition):
            transition(src, dst)

    def test_terminals(self) -> None:
        assert is_terminal(SituationStatus.RESOLVED)
        assert is_terminal(SituationStatus.DISMISSED)
        assert not is_terminal(SituationStatus.OPEN)


class TestHysteresis:
    def test_opens_on_high(self) -> None:
        decision, count = decide_situation(
            operational_band=RiskBand.RED, current_status=None, cycles_below_threshold=0
        )
        assert decision is SituationDecision.OPEN and count == 0

    def test_holds_below_high_when_none_open(self) -> None:
        decision, _ = decide_situation(
            operational_band=RiskBand.YELLOW, current_status=None, cycles_below_threshold=0
        )
        assert decision is SituationDecision.HOLD

    def test_resolves_only_after_n_low_cycles(self) -> None:
        # Two low cycles: still monitoring; third: resolve.
        d1, c1 = decide_situation(
            operational_band=RiskBand.GREEN,
            current_status=SituationStatus.OPEN,
            cycles_below_threshold=0,
            resolve_after_cycles_below=3,
        )
        assert d1 is SituationDecision.MONITOR and c1 == 1
        d2, c2 = decide_situation(
            operational_band=RiskBand.GREEN,
            current_status=SituationStatus.MONITORING,
            cycles_below_threshold=c1,
            resolve_after_cycles_below=3,
        )
        assert d2 is SituationDecision.MONITOR and c2 == 2
        d3, c3 = decide_situation(
            operational_band=RiskBand.GREEN,
            current_status=SituationStatus.MONITORING,
            cycles_below_threshold=c2,
            resolve_after_cycles_below=3,
        )
        assert d3 is SituationDecision.RESOLVE and c3 == 3

    def test_recross_resets_counter(self) -> None:
        d, c = decide_situation(
            operational_band=RiskBand.ORANGE,
            current_status=SituationStatus.MONITORING,
            cycles_below_threshold=2,
        )
        assert d is SituationDecision.OPEN and c == 0

    def test_between_bands_does_not_accrue(self) -> None:
        d, c = decide_situation(
            operational_band=RiskBand.YELLOW,
            current_status=SituationStatus.OPEN,
            cycles_below_threshold=1,
        )
        assert d is SituationDecision.MONITOR and c == 0


class TestBands:
    @pytest.mark.parametrize(
        "score,band",
        [
            (0.0, RiskBand.GREEN),
            (0.24, RiskBand.GREEN),
            (0.25, RiskBand.YELLOW),
            (0.49, RiskBand.YELLOW),
            (0.5, RiskBand.ORANGE),
            (0.74, RiskBand.ORANGE),
            (0.75, RiskBand.RED),
            (1.0, RiskBand.RED),
        ],
    )
    def test_band_thresholds(self, score: float, band: RiskBand) -> None:
        assert band_for_score(score) is band

    def test_band_out_of_range(self) -> None:
        with pytest.raises(ValueError):
            band_for_score(1.5)


class TestCombination:
    def test_no_lift_low_corroboration(self) -> None:
        c = combine(0.6, 0.1)  # orange base
        assert c.operational_band is RiskBand.ORANGE
        assert "no lift" in c.rule

    def test_lift_one_step(self) -> None:
        c = combine(0.6, 0.9)  # orange -> red
        assert c.operational_band is RiskBand.RED
        assert "raised one step" in c.rule

    def test_red_never_lifts_beyond(self) -> None:
        c = combine(0.9, 0.9)
        assert c.operational_band is RiskBand.RED

    def test_news_never_lowers(self) -> None:
        # Corroboration 0 must not drop below model band.
        c = combine(0.8, 0.0)
        assert c.operational_band is RiskBand.RED

    def test_rule_text_is_present_and_visible(self) -> None:
        assert combine(0.3, 0.0).rule  # non-empty applied-rule text

    def test_corroboration_out_of_range(self) -> None:
        with pytest.raises(ValueError):
            combine(0.3, 1.5)


class TestAlertInvariants:
    def test_idempotency_key_deterministic(self) -> None:
        k1 = derive_idempotency_key("a", "r", Channel.VOICE)
        k2 = derive_idempotency_key("a", "r", "voice")
        assert k1 == k2
        assert len(k1) == 64  # sha256 hex

    def test_idempotency_key_varies_by_triple(self) -> None:
        base = derive_idempotency_key("a", "r", "voice")
        assert base != derive_idempotency_key("a", "r", "sms")
        assert base != derive_idempotency_key("a", "r2", "voice")

    def test_human_gate_blocks_unsigned_approval(self) -> None:
        with pytest.raises(HumanGateViolation):
            ensure_approvable(AlertStatus.APPROVED, approved_by=None, approved_at=None)

    def test_human_gate_allows_signed(self) -> None:
        ensure_approvable(AlertStatus.APPROVED, approved_by="analyst", approved_at="2026-01-01")

    def test_non_dispatchable_states_need_no_signer(self) -> None:
        ensure_approvable(AlertStatus.PENDING_APPROVAL, approved_by=None, approved_at=None)
