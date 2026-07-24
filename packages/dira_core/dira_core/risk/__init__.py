"""Risk bands and the written two-score combination rule (DIRA-SPEC §3.3).

model_risk stays pure (climate + history). News corroboration is combined via
an explicit, visible rule — never learned into the quantitative model (ADR #19/20).
"""

from __future__ import annotations

from enum import StrEnum


class RiskBand(StrEnum):
    LOW = "low"
    WATCH = "watch"
    ELEVATED = "elevated"
    HIGH = "high"
    VERY_HIGH = "very_high"


COMBINATION_RULE_VERSION = "v1_weighted_70_30_with_corroboration_bump"

_BAND_ORDER: tuple[RiskBand, ...] = (
    RiskBand.LOW,
    RiskBand.WATCH,
    RiskBand.ELEVATED,
    RiskBand.HIGH,
    RiskBand.VERY_HIGH,
)

# Inclusive lower bounds for mapping a continuous score in [0, 1] to a band.
_SCORE_THRESHOLDS: tuple[tuple[float, RiskBand], ...] = (
    (0.80, RiskBand.VERY_HIGH),
    (0.65, RiskBand.HIGH),
    (0.45, RiskBand.ELEVATED),
    (0.25, RiskBand.WATCH),
    (0.00, RiskBand.LOW),
)

# Hysteresis helpers for situation open/resolve (DIRA-SPEC §3.1).
OPEN_BANDS = frozenset({RiskBand.HIGH, RiskBand.VERY_HIGH})
RESOLVE_BELOW_BANDS = frozenset({RiskBand.LOW, RiskBand.WATCH})


def band_from_score(score: float) -> RiskBand:
    s = max(0.0, min(1.0, float(score)))
    for threshold, band in _SCORE_THRESHOLDS:
        if s >= threshold:
            return band
    return RiskBand.LOW


def score_from_band(band: RiskBand) -> float:
    midpoints = {
        RiskBand.LOW: 0.12,
        RiskBand.WATCH: 0.35,
        RiskBand.ELEVATED: 0.55,
        RiskBand.HIGH: 0.72,
        RiskBand.VERY_HIGH: 0.90,
    }
    return midpoints[band]


def _bump(band: RiskBand, steps: int = 1) -> RiskBand:
    idx = _BAND_ORDER.index(band)
    return _BAND_ORDER[min(len(_BAND_ORDER) - 1, idx + steps)]


def corroboration_from_field_reports(verified_severities: list[int]) -> float:
    """Corroboration contributed by VERIFIED field-monitor reports.

    Callers must pass severities of verified reports only — unverified or
    dismissed reports contribute nothing, ever (red line: a raw field report
    alone never moves the operational band).

    Written rule: base 0.35 for any verified report, +0.15 per severity step
    above 1 of the worst report, +0.05 per extra report (max 3), capped 0.9.
    """
    if not verified_severities:
        return 0.0
    worst = max(1, min(3, max(int(s) for s in verified_severities)))
    extra = min(3, len(verified_severities) - 1)
    return min(0.9, 0.35 + 0.15 * (worst - 1) + 0.05 * extra)


def merge_corroboration(news: float, field: float) -> tuple[float, str]:
    """Combine the two independent corroboration channels.

    Max, not sum: channels corroborate the same underlying tension; stacking
    them would double-count. Returns (score, note) — the note is embedded in
    the persisted combination rule so the channel mix stays auditable.
    """
    n = max(0.0, min(1.0, float(news)))
    f = max(0.0, min(1.0, float(field)))
    score = max(n, f)
    note = f"corroboration=max(news {n:.2f}, verified_field_reports {f:.2f})"
    return score, note


def combine_scores(
    model_risk: float,
    corroboration: float,
    *,
    model_band: RiskBand | None = None,
    corroboration_note: str | None = None,
) -> tuple[RiskBand, str]:
    """Combine pure model_risk with corroboration (news + verified field reports).

    Returns (operational_band, combination_rule_text). The rule text is
    persisted on assessments so operators can see exactly why a band was chosen.
    """
    mr = max(0.0, min(1.0, float(model_risk)))
    corr = max(0.0, min(1.0, float(corroboration)))
    mb = model_band if model_band is not None else band_from_score(mr)

    operational_score = 0.7 * mr + 0.3 * corr
    band = band_from_score(operational_score)

    bumped = False
    if corr >= 0.7 and mb in {RiskBand.ELEVATED, RiskBand.HIGH, RiskBand.VERY_HIGH}:
        before = band
        band = _bump(band, 1)
        bumped = band is not before

    rule = (
        f"{COMBINATION_RULE_VERSION}: operational_score=0.7*model_risk({mr:.3f})"
        f"+0.3*corroboration({corr:.3f})={operational_score:.3f}→{band_from_score(operational_score)}"
    )
    if bumped:
        rule += f"; corroboration_bump→{band}"
    else:
        rule += f"; no_bump→{band}"
    if corroboration_note:
        rule += f"; {corroboration_note}"

    return band, rule
