"""Shared feature engineering (train ≡ serve). Imports only dira_core + pandas/numpy."""

from __future__ import annotations

from dira_features.builder import FEATURE_NAMES, FeatureBuilder
from dira_features.dekads import (
    dekad_end,
    dekad_of_year_index,
    enumerate_dekads,
    next_dekad,
    seasonality,
)

__all__ = [
    "FEATURE_NAMES",
    "FeatureBuilder",
    "dekad_end",
    "dekad_of_year_index",
    "enumerate_dekads",
    "next_dekad",
    "seasonality",
]
