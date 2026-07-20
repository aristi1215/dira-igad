"""The two-scores combination rule (invariant: a single VISIBLE rule).

`model_risk` (climate + history) and `corroboration` (confirmed news only) are combined into
an `operational_band` by this pure function, which ALSO returns the exact text of the applied
rule so it can be persisted in `assessments.combination_rule`. News can lift the band by at
most one step and can NEVER lower it — news never touches `model_risk` itself.
"""

from __future__ import annotations

from dataclasses import dataclass

from dira_core.enums import _BAND_ORDER as BAND_ORDER
from dira_core.enums import RiskBand
from dira_core.risk.bands import band_for_score

# Confirmed-news corroboration at or above this lifts the operational band one step.
CORROBORATION_LIFT_THRESHOLD = 0.5


@dataclass(frozen=True)
class Combination:
    operational_band: RiskBand
    rule: str


def _step_up(band: RiskBand) -> RiskBand:
    idx = min(band.rank + 1, len(BAND_ORDER) - 1)
    return BAND_ORDER[idx]


def combine(model_risk: float, corroboration: float) -> Combination:
    """Combine the two scores and return the operational band + the applied rule text."""
    if not 0.0 <= corroboration <= 1.0:
        raise ValueError(f"corroboration must be in [0, 1], got {corroboration}")
    base = band_for_score(model_risk)

    if corroboration >= CORROBORATION_LIFT_THRESHOLD and base is not RiskBand.RED:
        lifted = _step_up(base)
        rule = (
            f"operational_band = model_band({base.value}) raised one step to "
            f"{lifted.value} because confirmed-news corroboration "
            f"({corroboration:.2f}) >= {CORROBORATION_LIFT_THRESHOLD:.2f}"
        )
        return Combination(lifted, rule)

    rule = (
        f"operational_band = model_band({base.value}); corroboration "
        f"({corroboration:.2f}) < {CORROBORATION_LIFT_THRESHOLD:.2f}, no lift"
    )
    return Combination(base, rule)
