"""Train the LightGBM risk model with a temporal split, isotonic calibration, native TreeSHAP
and the three baselines. Pure compute — the caller persists artifacts + a model_versions row
(dira_ml must not import dira_data; layering).

SHAP uses LightGBM's built-in TreeSHAP (predict(pred_contrib=True)) — exact contributions
without the heavy `shap` dependency (DEVIATIONS.md §3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

import numpy as np

from dira_ml import baselines


def _matrix(rows: list[dict[str, Any]], feature_names: list[str]) -> np.ndarray:
    data = np.full((len(rows), len(feature_names)), np.nan, dtype=np.float64)
    for i, r in enumerate(rows):
        for j, name in enumerate(feature_names):
            v = r["features"].get(name)
            if v is not None:
                data[i, j] = v
    return data


@dataclass
class TrainedModel:
    classifier: Any
    regressor: Any
    calibrator: Any
    feature_names: list[str]
    card: dict[str, Any] = field(default_factory=dict)


def _temporal_split(rows: list[dict[str, Any]]) -> tuple[list, list, list]:
    dekads = sorted({r["dekad"] for r in rows})
    n = len(dekads)
    train_end = dekads[int(n * 0.7)]
    valid_end = dekads[int(n * 0.85)]

    def bucket(r: dict[str, Any]) -> int:
        if r["dekad"] < train_end:
            return 0
        if r["dekad"] < valid_end:
            return 1
        return 2

    train, valid, test = [], [], []
    for r in rows:
        (train, valid, test)[bucket(r)].append(r)
    return train, valid, test


def train(rows: list[dict[str, Any]], feature_names: list[str]) -> TrainedModel:
    import lightgbm as lgb
    from sklearn.isotonic import IsotonicRegression
    from sklearn.metrics import brier_score_loss, mean_absolute_error, roc_auc_score

    train_rows, valid_rows, test_rows = _temporal_split(rows)

    Xtr, Xva, Xte = (_matrix(r, feature_names) for r in (train_rows, valid_rows, test_rows))
    ytr_c = np.array([r["occurred"] for r in train_rows])
    yva_c = np.array([r["occurred"] for r in valid_rows])
    yte_c = np.array([r["occurred"] for r in test_rows])
    ytr_r = np.array([r["incidents"] for r in train_rows], dtype=float)
    yte_r = np.array([r["incidents"] for r in test_rows], dtype=float)

    params = dict(
        n_estimators=200, learning_rate=0.05, num_leaves=31, min_child_samples=20,
        random_state=42, deterministic=True, force_row_wise=True, verbosity=-1,
    )
    classifier = lgb.LGBMClassifier(**params)
    classifier.fit(Xtr, ytr_c)
    regressor = lgb.LGBMRegressor(**params)
    regressor.fit(Xtr, ytr_r)

    # Isotonic calibration of P(conflict) on the validation block (out-of-time).
    raw_va = classifier.predict_proba(Xva)[:, 1]
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(raw_va, yva_c)

    # Evaluate on the held-out (latest) test block.
    raw_te = classifier.predict_proba(Xte)[:, 1]
    cal_te = calibrator.predict(raw_te)
    reg_te = regressor.predict(Xte)

    metrics: dict[str, Any] = {}
    if len(set(yte_c.tolist())) > 1:
        metrics["auc"] = float(roc_auc_score(yte_c, cal_te))
    metrics["brier"] = float(brier_score_loss(yte_c, cal_te))
    metrics["incidents_mae"] = float(mean_absolute_error(yte_r, reg_te))

    # Baselines (expected-incidents MAE against the same test block).
    b_persist = baselines.persistence(test_rows)
    b_clim = baselines.climatology(train_rows + valid_rows, test_rows)
    b_cast = baselines.cast_aggregate(train_rows + valid_rows, test_rows)
    metrics["baselines"] = {
        "persistence_mae": float(mean_absolute_error(yte_r, b_persist)),
        "climatology_mae": float(mean_absolute_error(yte_r, b_clim)),
        "cast_aggregate_mae": float(mean_absolute_error(yte_r, b_cast)),
    }

    # Native TreeSHAP mean-|contribution| per feature (importance for the model card).
    contribs = classifier.booster_.predict(Xte, pred_contrib=True)
    mean_abs = np.abs(contribs[:, : len(feature_names)]).mean(axis=0)
    metrics["shap_importance"] = {
        feature_names[i]: float(mean_abs[i]) for i in range(len(feature_names))
    }

    card = {
        "kind": "lightgbm",
        "created_at": datetime.now(UTC).isoformat(),
        "feature_list": feature_names,
        "n_train": len(train_rows),
        "n_valid": len(valid_rows),
        "n_test": len(test_rows),
        "train_end": _min_max(train_rows),
        "test_range": _min_max(test_rows),
        "metrics": metrics,
        "params": params,
        "notes": "SHAP via LightGBM native pred_contrib; isotonic calibration on validation.",
    }
    return TrainedModel(classifier, regressor, calibrator, feature_names, card)


def _min_max(rows: list[dict[str, Any]]) -> dict[str, str]:
    if not rows:
        return {}
    ds: list[date] = [r["dekad"] for r in rows]
    return {"min": min(ds).isoformat(), "max": max(ds).isoformat()}
