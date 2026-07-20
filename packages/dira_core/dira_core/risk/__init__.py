"""Risk bands and the written two-score combination rule.

model_risk stays pure (climate + history only). News corroboration is combined
via an explicit, visible rule — never learned into the quantitative model.
"""

from __future__ import annotations

from enum import StrEnum


class RiskBand(StrEnum):
    LOW = "low"
    WATCH = "watch"
    ELEVATED = "elevated"
    HIGH = "high"
    VERY_HIGH = "very_high"


# Placeholder — implement band calibration + combination_rule text here.
COMBINATION_RULE_VERSION = "v1_placeholder"
