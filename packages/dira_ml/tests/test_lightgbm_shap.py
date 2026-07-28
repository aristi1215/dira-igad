"""LightGBM adapter SHAP attribution tests."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pytest
from dira_core.ports import FeatureRow
from dira_features import FEATURE_NAMES
from dira_ml.lightgbm_adapter import LightGBMAdapter


def _tiny_artifact(tmp_path: Path) -> Path:
    from lightgbm import LGBMClassifier, LGBMRegressor

    rng = np.random.default_rng(0)
    x = rng.normal(size=(40, len(FEATURE_NAMES)))
    y = (x[:, 0] + x[:, 7] > 0).astype(int)
    y_reg = x[:, 7].clip(0)

    classifier = LGBMClassifier(n_estimators=8, random_state=0, verbose=-1)
    regressor = LGBMRegressor(n_estimators=8, random_state=0, verbose=-1)
    classifier.fit(x, y)
    regressor.fit(x, y_reg)

    path = tmp_path / "model_test.joblib"
    joblib.dump(
        {
            "feature_list": list(FEATURE_NAMES),
            "classifier": classifier,
            "regressor": regressor,
            "kind": "lightgbm",
        },
        path,
    )
    return path


def test_lightgbm_assess_returns_shap_dict(tmp_path: Path) -> None:
    path = _tiny_artifact(tmp_path)
    adapter = LightGBMAdapter(path)
    values = {name: 0.0 for name in FEATURE_NAMES}
    values["rain_mm"] = 5.0
    values["incident_count_dekad"] = 2.0
    assessment = adapter.assess(FeatureRow("z", date(2026, 3, 1), values))
    assert 0.0 <= assessment.model_risk <= 1.0
    assert assessment.shap
    assert set(assessment.shap.keys()) <= set(FEATURE_NAMES)


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("shap") is None,
    reason="shap extra not installed",
)
def test_lightgbm_uses_real_shap_when_available(tmp_path: Path) -> None:
    path = _tiny_artifact(tmp_path)
    adapter = LightGBMAdapter(path)
    values = {name: float(i) * 0.1 for i, name in enumerate(FEATURE_NAMES)}
    assessment = adapter.assess(FeatureRow("z", date(2026, 3, 1), values))
    assert any(v < 0 for v in assessment.shap.values()) or any(
        abs(v) > 0 for v in assessment.shap.values()
    )
    assert adapter._explainer is not None
