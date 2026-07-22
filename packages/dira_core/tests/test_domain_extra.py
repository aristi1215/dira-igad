"""Extra domain coverage for ports, time helpers, and risk utilities."""

from __future__ import annotations

import os
from datetime import date, datetime

os.environ.pop("DATABASE_URL", None)

from dira_core.ports import (  # noqa: E402
    Assessment,
    AudioRef,
    ConflictEvent,
    FeatureRow,
    ProviderRef,
)
from dira_core.risk import RiskBand, score_from_band  # noqa: E402
from dira_core.time import (  # noqa: E402
    data_cutoff_for_cycle,
    dekad_end,
    iter_dekads,
    next_dekad,
    previous_dekad,
)


def test_ports_dataclasses() -> None:
    ev = ConflictEvent(
        event_id="e1",
        event_date=date(2026, 1, 1),
        zone_id=None,
        event_type="Battles",
        fatalities=0,
        available_at=datetime(2026, 1, 3),
    )
    assert ev.zone_id is None
    row = FeatureRow(zone_id="z", dekad_start=date(2026, 1, 1), values={"rain_mm": 1.0})
    assert row.values["rain_mm"] == 1.0
    a = Assessment(0.1, 0.2, 0.3, "low", {"rain_mm": 0.1})
    assert a.model_band == "low"
    assert AudioRef(url="http://x", language="sw").language == "sw"
    assert ProviderRef(provider_message_id="p1").provider_message_id == "p1"


def test_score_from_band_and_dekad_edges() -> None:
    assert score_from_band(RiskBand.LOW) < score_from_band(RiskBand.VERY_HIGH)
    assert dekad_end(date(2026, 1, 1)) == date(2026, 1, 10)
    assert dekad_end(date(2026, 1, 11)) == date(2026, 1, 20)
    assert next_dekad(date(2026, 12, 21)) == date(2027, 1, 1)
    assert previous_dekad(date(2026, 1, 1)) == date(2025, 12, 21)
    assert previous_dekad(date(2026, 3, 21)) == date(2026, 3, 11)
    assert next_dekad(date(2026, 3, 1)) == date(2026, 3, 11)
    assert next_dekad(date(2026, 3, 11)) == date(2026, 3, 21)
    dekads = iter_dekads(date(2026, 1, 1), date(2026, 2, 1))
    assert dekads[0] == date(2026, 1, 1)
    assert dekads[-1] == date(2026, 2, 1)
    assert data_cutoff_for_cycle(date(2026, 2, 21)) == date(2026, 2, 28)
