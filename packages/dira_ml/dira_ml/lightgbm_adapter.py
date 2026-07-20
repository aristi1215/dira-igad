"""LightGBM artifact adapter with transparent fallback."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
from dira_core.ports import Assessment, FeatureRow
from dira_core.risk import band_from_score
from dira_features import FEATURE_NAMES

from dira_ml.transparent import TransparentIndexAdapter


class LightGBMAdapter:
    """RiskModel backed by a saved joblib artifact when available."""

    def __init__(self, artifact_path: str | Path = "artifacts/model_v1.lgb") -> None:
        self.artifact_path = Path(artifact_path)
        self.fallback = TransparentIndexAdapter()
        self.artifact: dict[str, Any] | None = self._load_artifact(self.artifact_path)

    def assess(self, features: FeatureRow) -> Assessment:
        if self.artifact is None:
            return self.fallback.assess(features)

        feature_list = list(self.artifact.get("feature_list", FEATURE_NAMES))
        vector = np.array(
            [[features.values.get(name, np.nan) for name in feature_list]],
            dtype=float,
        )
        classifier = self.artifact.get("classifier")
        regressor = self.artifact.get("regressor")

        try:
            prob_conflict = _predict_probability(classifier, vector)
            expected_incidents = _predict_value(regressor, vector)
        except Exception:
            return self.fallback.assess(features)

        model_risk = max(0.0, min(1.0, prob_conflict))
        fallback_assessment = self.fallback.assess(features)
        return Assessment(
            prob_conflict=model_risk,
            expected_incidents=max(0.0, expected_incidents),
            model_risk=model_risk,
            model_band=band_from_score(model_risk).value,
            shap=fallback_assessment.shap,
        )

    @staticmethod
    def _load_artifact(path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        loaded = joblib.load(path)
        return loaded if isinstance(loaded, dict) else None


def _predict_probability(model: Any, vector: np.ndarray) -> float:
    if model is None:
        raise ValueError("missing classifier")
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(vector)
        if probabilities.shape[1] == 1:
            return float(probabilities[0, 0])
        return float(probabilities[0, 1])
    prediction = model.predict(vector)
    return float(prediction[0])


def _predict_value(model: Any, vector: np.ndarray) -> float:
    if model is None:
        return _predict_probability(model, vector)
    prediction = model.predict(vector)
    return float(prediction[0])
