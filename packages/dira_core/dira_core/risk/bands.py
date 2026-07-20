"""Risk banding (DIRA-SPEC.md §3.2). Pure thresholds on the calibrated model_risk score."""

from __future__ import annotations

from dira_core.enums import RiskBand

# green < 0.25 <= yellow < 0.5 <= orange < 0.75 <= red
_THRESHOLDS: list[tuple[float, RiskBand]] = [
    (0.75, RiskBand.RED),
    (0.50, RiskBand.ORANGE),
    (0.25, RiskBand.YELLOW),
]


def band_for_score(score: float) -> RiskBand:
    """Map a calibrated score in [0, 1] to its risk band."""
    if not 0.0 <= score <= 1.0:
        raise ValueError(f"score must be in [0, 1], got {score}")
    for threshold, band in _THRESHOLDS:
        if score >= threshold:
            return band
    return RiskBand.GREEN
