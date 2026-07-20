from __future__ import annotations

from datetime import date

from dira_data.adapters import SeededAcledAdapter, SeededRasterAdapter


def test_seeded_adapters_read_fixture_values() -> None:
    conflicts = SeededAcledAdapter().events(["mandera_ke_north"], date(2026, 3, 1))
    hazards = SeededRasterAdapter().fetch_dekadal(["mandera_ke_north"], date(2026, 3, 11))

    assert [event.event_id for event in conflicts if event.event_id == "seed-acled-2026-0005"]
    assert hazards["mandera_ke_north"]["rain_mm"] == 0.3
    assert hazards["mandera_ke_north"]["ndvi_mean"] == 0.06
    assert hazards["mandera_ke_north"]["rain_available_at"].isoformat().startswith("2026-03-16")
