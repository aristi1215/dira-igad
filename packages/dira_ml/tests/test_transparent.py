from __future__ import annotations

from datetime import date

from dira_core.ports import FeatureRow
from dira_features import FEATURE_NAMES
from dira_ml.transparent import TransparentIndexAdapter


def test_transparent_index_assess_skips_nulls_and_bounds_outputs() -> None:
    feature_values = {name: None for name in FEATURE_NAMES}
    feature_values["incident_count_dekad"] = 3.0
    feature_values["rain_mm"] = 0.0
    row = FeatureRow("mandera_ke_north", date(2026, 3, 11), feature_values)

    assessment = TransparentIndexAdapter().assess(row)

    assert 0.0 <= assessment.prob_conflict <= 1.0
    assert 0.0 <= assessment.model_risk <= 1.0
    assert assessment.expected_incidents >= 0.0
    assert assessment.model_band in {"low", "watch", "elevated", "high", "very_high"}
    assert set(assessment.shap) == {"rain_mm", "incident_count_dekad"}


def test_feature_list_excludes_acled_notes() -> None:
    joined = " ".join(FEATURE_NAMES).lower()

    assert "notes" not in joined
    assert "actor" not in joined
    assert len(FEATURE_NAMES) == len(set(FEATURE_NAMES))
