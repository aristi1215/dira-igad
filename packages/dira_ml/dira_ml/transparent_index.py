"""Transparent weighted index (RiskModel). Registrable as kind='transparent_index'.

The seeded fallback and an honest, fully-inspectable baseline model: model_risk is a fixed
weighted sum of normalized features through a logistic squash. Every contribution is exposed
as a pseudo-SHAP value, so the explanation ("why") is exactly the top contributors — no black
box. Uses ONLY climate + conflict-history features (no news, no actors).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from dira_core.ports import Assessment, FeatureRow
from dira_core.risk.bands import band_for_score


@dataclass(frozen=True)
class _Term:
    center: float
    scale: float
    sign: float   # +1 raises risk as the (normalized) feature grows, -1 lowers it
    weight: float


# Drought stress (negative rain anomaly, low NDVI) + recent/neighbouring incidents raise risk.
_TERMS: dict[str, _Term] = {
    "rain_anom_mean3": _Term(0.0, 20.0, -1.0, 1.4),
    "ndvi_anom_mean3": _Term(0.0, 0.1, -1.0, 1.1),
    "incidents_sum3": _Term(1.5, 3.0, 1.0, 1.6),
    "incidents_lag1": _Term(0.5, 2.0, 1.0, 1.0),
    "incident_trend3": _Term(0.0, 3.0, 1.0, 0.8),
    "neigh_incidents_sum3": _Term(2.0, 5.0, 1.0, 0.9),
    "fatalities_sum3": _Term(1.0, 4.0, 1.0, 0.7),
}
_BIAS = -0.6


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


class TransparentIndexAdapter:
    """RiskModel implemented as a transparent normalized weighted index."""

    kind = "transparent_index"

    def assess(self, features: FeatureRow) -> Assessment:
        contributions: dict[str, float] = {}
        total = _BIAS
        for name, term in _TERMS.items():
            value = features.values.get(name)
            if value is None:
                contributions[name] = 0.0
                continue
            norm = max(-1.0, min(1.0, (value - term.center) / term.scale))
            contrib = term.sign * term.weight * norm
            contributions[name] = contrib
            total += contrib
        model_risk = _sigmoid(total)
        band = band_for_score(model_risk)
        # Regressor head: expected incidents scaled from risk (monotone, transparent).
        expected_incidents = round(6.0 * model_risk, 3)
        return Assessment(
            prob_conflict=model_risk,
            expected_incidents=expected_incidents,
            model_risk=model_risk,
            model_band=band.value,
            shap=contributions,
        )
