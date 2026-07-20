"""LightGBMAdapter (RiskModel) — the live risk model. Loads the trained artifacts and returns
calibrated model_risk, expected incidents, and exact TreeSHAP contributions per feature."""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from dira_core.ports import Assessment, FeatureRow
from dira_core.risk.bands import band_for_score


class LightGBMAdapter:
    kind = "lightgbm"

    def __init__(self, out_dir: Path, version: str = "v1") -> None:
        import lightgbm as lgb

        self._booster = lgb.Booster(model_file=str(out_dir / f"model_{version}.lgb"))
        bundle = joblib.load(out_dir / f"model_{version}.bundle.joblib")
        self._regressor = bundle["regressor"]
        self._calibrator = bundle["calibrator"]
        self.feature_names: list[str] = bundle["feature_names"]

    def _vector(self, features: FeatureRow) -> np.ndarray:
        vec = np.full((1, len(self.feature_names)), np.nan, dtype=np.float64)
        for j, name in enumerate(self.feature_names):
            v = features.values.get(name)
            if v is not None:
                vec[0, j] = v
        return vec

    def assess(self, features: FeatureRow) -> Assessment:
        vec = self._vector(features)
        raw = float(self._booster.predict(vec)[0])
        model_risk = float(self._calibrator.predict([raw])[0])
        model_risk = max(0.0, min(1.0, model_risk))
        expected = float(self._regressor.predict(vec)[0])
        contribs = self._booster.predict(vec, pred_contrib=True)[0]
        shap = {self.feature_names[i]: float(contribs[i]) for i in range(len(self.feature_names))}
        return Assessment(
            prob_conflict=model_risk,
            expected_incidents=round(max(0.0, expected), 3),
            model_risk=model_risk,
            model_band=band_for_score(model_risk).value,
            shap=shap,
        )
