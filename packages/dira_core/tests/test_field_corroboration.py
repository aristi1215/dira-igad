"""Field-report corroboration rules (pure domain)."""

from __future__ import annotations

import pytest
from dira_core.risk import (
    RiskBand,
    combine_scores,
    corroboration_from_field_reports,
    merge_corroboration,
)


def test_no_reports_contribute_zero() -> None:
    assert corroboration_from_field_reports([]) == 0.0


def test_single_low_severity_report() -> None:
    assert corroboration_from_field_reports([1]) == pytest.approx(0.35)


def test_severity_raises_score() -> None:
    assert corroboration_from_field_reports([3]) == pytest.approx(0.65)
    assert corroboration_from_field_reports([2]) == pytest.approx(0.50)


def test_extra_reports_add_but_cap() -> None:
    assert corroboration_from_field_reports([3, 3]) == pytest.approx(0.70)
    # Many severe reports cap at 0.9 — field reports alone never saturate to 1.0.
    assert corroboration_from_field_reports([3] * 10) == pytest.approx(0.80)
    assert corroboration_from_field_reports([3] * 10) <= 0.9


def test_out_of_range_severities_clamped() -> None:
    assert corroboration_from_field_reports([7]) == corroboration_from_field_reports([3])
    assert corroboration_from_field_reports([0]) == corroboration_from_field_reports([1])


def test_merge_is_max_not_sum() -> None:
    score, note = merge_corroboration(0.6, 0.5)
    assert score == pytest.approx(0.6)
    assert "news 0.60" in note and "verified_field_reports 0.50" in note

    score, _ = merge_corroboration(0.2, 0.65)
    assert score == pytest.approx(0.65)


def test_merge_clamps_inputs() -> None:
    score, _ = merge_corroboration(1.7, -0.3)
    assert score == 1.0


def test_combination_rule_records_channel_note() -> None:
    _, note = merge_corroboration(0.0, 0.5)
    band, rule = combine_scores(0.7, 0.5, corroboration_note=note)
    assert isinstance(band, RiskBand)
    assert "verified_field_reports 0.50" in rule


def test_combination_rule_without_note_unchanged() -> None:
    band_a, rule_a = combine_scores(0.7, 0.5)
    band_b, _ = combine_scores(0.7, 0.5, corroboration_note=None)
    assert band_a is band_b
    assert "verified_field_reports" not in rule_a
