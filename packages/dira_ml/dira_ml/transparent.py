"""Transparent weighted-index risk model."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from dira_core.ports import Assessment, FeatureRow
from dira_core.risk import band_from_score
from dira_features import FEATURE_NAMES

FeatureRange = tuple[float, float, bool]

DEFAULT_WEIGHTS: dict[str, float] = {
    "rain_mm": 0.12,
    "rain_lag1": 0.08,
    "rain_lag2": 0.04,
    "rain_anomaly": 0.10,
    "ndvi_mean": 0.12,
    "ndvi_lag1": 0.08,
    "ndvi_anomaly": 0.10,
    "incident_count_dekad": 0.16,
    "incident_count_lag1": 0.08,
    "incident_trend": 0.06,
    "neighbor_incident_mean": 0.04,
    "month_sin": 0.01,
    "month_cos": 0.01,
}

FEATURE_RANGES: dict[str, FeatureRange] = {
    "rain_mm": (0.0, 60.0, True),
    "rain_lag1": (0.0, 60.0, True),
    "rain_lag2": (0.0, 60.0, True),
    "rain_anomaly": (-30.0, 30.0, True),
    "ndvi_mean": (0.0, 0.6, True),
    "ndvi_lag1": (0.0, 0.6, True),
    "ndvi_anomaly": (-0.25, 0.25, True),
    "incident_count_dekad": (0.0, 5.0, False),
    "incident_count_lag1": (0.0, 5.0, False),
    "incident_trend": (-3.0, 3.0, False),
    "neighbor_incident_mean": (0.0, 3.0, False),
    "month_sin": (-1.0, 1.0, False),
    "month_cos": (-1.0, 1.0, False),
}


@dataclass(frozen=True)
class TransparentIndexAdapter:
    """RiskModel that exposes every weighted contribution."""

    weights: dict[str, float] = field(default_factory=lambda: DEFAULT_WEIGHTS.copy())

    def assess(self, features: FeatureRow) -> Assessment:
        weighted_sum = 0.0
        total_weight = 0.0
        raw_contributions: dict[str, float] = {}

        for feature_name in FEATURE_NAMES:
            value = features.values.get(feature_name)
            if value is None or not math.isfinite(float(value)):
                continue
            weight = float(self.weights.get(feature_name, 0.0))
            if weight == 0.0:
                continue
            normalized = _normalize(feature_name, float(value))
            contribution = weight * normalized
            weighted_sum += contribution
            total_weight += abs(weight)
            raw_contributions[feature_name] = contribution

        # Stretch the normalized index so drought-stressed seeded Mandera zones
        # reach operational open bands (high / very_high) without a black-box bump.
        raw_risk = (weighted_sum / total_weight) if total_weight else 0.0
        model_risk = _clamp01(raw_risk ** 0.85 + 0.08 * raw_risk)
        shap = {
            feature_name: abs(contribution) / total_weight
            for feature_name, contribution in raw_contributions.items()
        } if total_weight else {}
        prob_conflict = model_risk
        expected_incidents = max(0.0, model_risk * 3.0)
        return Assessment(
            prob_conflict=prob_conflict,
            expected_incidents=expected_incidents,
            model_risk=model_risk,
            model_band=band_from_score(model_risk).value,
            shap=shap,
        )


def _normalize(feature_name: str, value: float) -> float:
    low, high, invert = FEATURE_RANGES.get(feature_name, (0.0, 1.0, False))
    if high <= low:
        return 0.0
    normalized = _clamp01((value - low) / (high - low))
    return 1.0 - normalized if invert else normalized


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))
