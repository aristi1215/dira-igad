"""LightGBM artifact adapter with real SHAP attributions when available."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from dira_core.ports import Assessment, FeatureRow
from dira_core.risk import band_from_score
from dira_features import FEATURE_NAMES

from dira_ml.transparent import TransparentIndexAdapter

logger = logging.getLogger("dira.ml.lightgbm")


class LightGBMAdapter:
    """RiskModel backed by a saved joblib artifact when available.

    Probabilities come from the LightGBM classifier; feature attributions use
    ``shap.TreeExplainer`` when the ``shap`` package is installed, otherwise
    fall back to TransparentIndex contributions so the UI never goes blank.
    """

    def __init__(self, artifact_path: str | Path = "artifacts/model_v1.lgb") -> None:
        self.artifact_path = Path(artifact_path)
        self.fallback = TransparentIndexAdapter()
        self.artifact: dict[str, Any] | None = self._load_artifact(self.artifact_path)
        self._explainer: Any | None = None
        self._explainer_ready = False

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
        shap_values = self._shap_for_row(classifier, feature_list, vector)
        if shap_values is None:
            shap_values = self.fallback.assess(features).shap

        return Assessment(
            prob_conflict=model_risk,
            expected_incidents=max(0.0, expected_incidents),
            model_risk=model_risk,
            model_band=band_from_score(model_risk).value,
            shap=shap_values,
        )

    def _shap_for_row(
        self,
        classifier: Any,
        feature_list: list[str],
        vector: np.ndarray,
    ) -> dict[str, float] | None:
        explainer = self._get_explainer(classifier)
        if explainer is None:
            return None
        try:
            explanation = explainer(vector)
            values = np.asarray(explanation.values)
            # Binary classifier → (1, n_features, 2) or (1, n_features)
            if values.ndim == 3:
                # Prefer positive-class column when present.
                values = values[0, :, -1]
            elif values.ndim == 2:
                values = values[0]
            else:
                values = values.reshape(-1)
            out: dict[str, float] = {}
            for name, raw in zip(feature_list, values.tolist(), strict=False):
                if name and np.isfinite(raw):
                    out[name] = float(raw)
            return out
        except Exception as exc:  # noqa: BLE001
            logger.warning("SHAP TreeExplainer failed — using transparent fallback: %s", exc)
            return None

    def _get_explainer(self, classifier: Any) -> Any | None:
        if self._explainer_ready:
            return self._explainer
        self._explainer_ready = True
        if classifier is None:
            return None
        try:
            import shap
        except ImportError:
            logger.info(
                "shap package not installed — attributions fall back to TransparentIndex "
                "(uv sync --extra explain --package dira-ml)"
            )
            return None
        try:
            self._explainer = shap.TreeExplainer(classifier)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not build TreeExplainer: %s", exc)
            self._explainer = None
        return self._explainer

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
