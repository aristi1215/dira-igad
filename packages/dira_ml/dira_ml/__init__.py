"""ML training, evaluation, SHAP explanations, and artifact management."""

from __future__ import annotations

from dira_ml.baselines import brier_score, cast_aggregate, climatology, mae, persistence
from dira_ml.lightgbm_adapter import LightGBMAdapter
from dira_ml.transparent import DEFAULT_WEIGHTS, FEATURE_RANGES, TransparentIndexAdapter

__all__ = [
    "DEFAULT_WEIGHTS",
    "FEATURE_RANGES",
    "LightGBMAdapter",
    "TransparentIndexAdapter",
    "brier_score",
    "cast_aggregate",
    "climatology",
    "mae",
    "persistence",
]
