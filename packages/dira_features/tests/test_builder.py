"""M4: bitemporal-cut (leakage) and structural tests for the shared feature builder.

Pure — no DB, no network. Runs with empty DATABASE_URL.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from dira_features import FEATURE_NAMES, FeatureBuilder, enumerate_dekads


def _cutoff(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _climate_row(zone: str, d: date, rain: float, avail: datetime) -> dict:
    return {
        "zone_id": zone,
        "dekad_start": d,
        "rain_mm": rain,
        "rain_anomaly": rain - 10.0,
        "rain_available_at": avail,
        "ndvi": 0.3,
        "ndvi_anomaly": 0.0,
        "ndvi_available_at": avail,
    }


def test_value_published_after_cutoff_is_null() -> None:
    dekads = enumerate_dekads(date(2025, 1, 1), date(2025, 3, 21))
    ref = date(2025, 3, 1)
    prev = date(2025, 2, 21)
    # Previous dekad's rain becomes available AFTER the cutoff -> must be NULL (no leakage).
    late = datetime(2025, 3, 15, tzinfo=UTC)
    builder = FeatureBuilder([_climate_row("z", prev, 30.0, late)], [], [], dekads)
    row = builder.row("z", ref, _cutoff(ref))
    assert row["rain_anom_lag1"] is None

    # Same value published BEFORE the cutoff -> visible.
    early = datetime(2025, 2, 25, tzinfo=UTC)
    builder2 = FeatureBuilder([_climate_row("z", prev, 30.0, early)], [], [], dekads)
    row2 = builder2.row("z", ref, _cutoff(ref))
    assert row2["rain_anom_lag1"] == 20.0


def test_no_neighbors_gives_null_neighbourhood() -> None:
    dekads = enumerate_dekads(date(2025, 1, 1), date(2025, 3, 21))
    ref = date(2025, 3, 1)
    early = datetime(2025, 1, 1, tzinfo=UTC)
    climate = [_climate_row("z", d, 20.0, early) for d in dekads]
    builder = FeatureBuilder(climate, [], [], dekads)  # no adjacency
    row = builder.row("z", ref, _cutoff(ref))
    assert row["neigh_incidents_sum3"] is None
    assert row["neigh_rain_anom_mean3"] is None


def test_insufficient_history_is_null() -> None:
    dekads = enumerate_dekads(date(2025, 1, 1), date(2025, 12, 21))
    ref = date(2025, 1, 1)  # first dekad: no lags at all
    builder = FeatureBuilder([], [], [], dekads)
    row = builder.row("z", ref, _cutoff(ref))
    assert row["rain_anom_lag1"] is None
    assert row["rain_anom_mean6"] is None
    assert row["incidents_sum3"] is None


def test_out_of_zone_events_excluded() -> None:
    dekads = enumerate_dekads(date(2025, 1, 1), date(2025, 3, 21))
    events = [
        {"zone_id": None, "event_date": date(2025, 2, 15), "fatalities": 3,
         "available_at": datetime(2025, 2, 20, tzinfo=UTC)}
    ]
    builder = FeatureBuilder([], events, [], dekads)
    ref = date(2025, 3, 1)
    row = builder.row("z", ref, _cutoff(ref))
    # No zone events -> incident window is 0 (history exists) not driven by the null-zone event.
    assert row["incidents_lag1"] == 0.0


def test_no_feature_name_references_actors_or_notes() -> None:
    banned = ("note", "actor", "ethnic", "clan", "community", "tribe")
    for name in FEATURE_NAMES:
        assert not any(b in name.lower() for b in banned)


def test_label_counts_events_in_the_dekad() -> None:
    dekads = enumerate_dekads(date(2025, 1, 1), date(2025, 3, 21))
    events = [
        {"zone_id": "z", "event_date": date(2025, 3, 3), "fatalities": 1,
         "available_at": datetime(2025, 3, 5, tzinfo=UTC)},
        {"zone_id": "z", "event_date": date(2025, 3, 8), "fatalities": 2,
         "available_at": datetime(2025, 3, 9, tzinfo=UTC)},
    ]
    builder = FeatureBuilder([], events, [], dekads)
    occurred, incidents = builder.label("z", date(2025, 3, 1))
    assert occurred == 1 and incidents == 2.0
