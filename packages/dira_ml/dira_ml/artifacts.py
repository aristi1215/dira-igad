"""Persist and load trained model artifacts. The classifier booster is saved as native
LightGBM text (``model_vX.lgb``); the regressor + calibrator + feature list ride alongside in
a joblib bundle so the inference adapter can reconstruct the exact model."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib

from dira_ml.train import TrainedModel


def save(model: TrainedModel, out_dir: Path, version: str = "v1") -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    lgb_path = out_dir / f"model_{version}.lgb"
    model.classifier.booster_.save_model(str(lgb_path))
    bundle_path = out_dir / f"model_{version}.bundle.joblib"
    joblib.dump(
        {
            "regressor": model.regressor,
            "calibrator": model.calibrator,
            "feature_names": model.feature_names,
        },
        bundle_path,
    )
    card_path = out_dir / "model_card.json"
    card_path.write_text(json.dumps(model.card, indent=2))
    return {"lgb": str(lgb_path), "bundle": str(bundle_path), "card": str(card_path)}


def load_card(out_dir: Path) -> dict[str, Any]:
    return json.loads((out_dir / "model_card.json").read_text())
