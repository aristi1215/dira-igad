"""Shared feature engineering for training and inference.

Must be identical in both paths. Bitemporal cut: only values with
available_at <= cycle date. ACLED notes never enter as features (label leak).
"""

from __future__ import annotations

from dira_features.builder import FEATURE_NAMES, build_feature_row

__all__ = ["FEATURE_NAMES", "build_feature_row"]
