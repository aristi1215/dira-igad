from __future__ import annotations

import math
from datetime import UTC, date, datetime

import pytest
from dira_features import FEATURE_NAMES, build_feature_row


def test_temporal_leakage() -> None:
    cutoff = datetime(2026, 3, 12, tzinfo=UTC)
    row = build_feature_row(
        "zone-a",
        date(2026, 3, 11),
        climate_rows=[
            {
                "zone_id": "zone-a",
                "dekad_start": date(2026, 3, 1),
                "rain_mm": 20.0,
                "rain_available_at": datetime(2026, 3, 2, tzinfo=UTC),
                "ndvi_mean": 0.30,
                "ndvi_available_at": datetime(2026, 3, 2, tzinfo=UTC),
            },
            {
                "zone_id": "zone-a",
                "dekad_start": date(2026, 3, 11),
                "rain_mm": 99.0,
                "rain_available_at": datetime(2026, 3, 13, tzinfo=UTC),
                "ndvi_mean": 0.40,
                "ndvi_available_at": datetime(2026, 3, 12, tzinfo=UTC),
            },
        ],
        acled_events=[],
        adjacency_neighbor_ids=[],
        data_cutoff=cutoff,
    )

    assert row.values["rain_mm"] is None
    assert row.values["rain_anomaly"] is None
    assert row.values["rain_lag1"] == 20.0
    assert row.values["ndvi_mean"] == 0.40


def test_train_serve_identical() -> None:
    cutoff = datetime(2026, 3, 15, tzinfo=UTC)
    climate_rows = [
        {
            "zone_id": "zone-a",
            "dekad_start": date(2026, 2, 21),
            "rain_mm": 10.0,
            "rain_available_at": datetime(2026, 2, 22, tzinfo=UTC),
            "ndvi_mean": 0.25,
            "ndvi_available_at": datetime(2026, 2, 22, tzinfo=UTC),
        },
        {
            "zone_id": "zone-a",
            "dekad_start": date(2026, 3, 1),
            "rain_mm": 30.0,
            "rain_available_at": datetime(2026, 3, 2, tzinfo=UTC),
            "ndvi_mean": 0.30,
            "ndvi_available_at": datetime(2026, 3, 2, tzinfo=UTC),
        },
        {
            "zone_id": "zone-a",
            "dekad_start": date(2026, 3, 11),
            "rain_mm": 45.0,
            "rain_available_at": datetime(2026, 3, 12, tzinfo=UTC),
            "ndvi_mean": None,
            "ndvi_available_at": datetime(2026, 3, 12, tzinfo=UTC),
        },
    ]
    acled_events = [
        {
            "zone_id": "zone-a",
            "event_date": date(2026, 3, 11),
            "available_at": datetime(2026, 3, 12, tzinfo=UTC),
            "fatalities": 0,
            "notes": "not a feature",
        },
        {
            "zone_id": "zone-a",
            "event_date": date(2026, 3, 15),
            "available_at": datetime(2026, 3, 16, tzinfo=UTC),
            "fatalities": 10,
            "notes": "late event ignored",
        },
        {
            "zone_id": "zone-a",
            "event_date": date(2026, 3, 1),
            "available_at": datetime(2026, 3, 2, tzinfo=UTC),
            "fatalities": 1,
            "notes": "lag event",
        },
        {
            "zone_id": "zone-b",
            "event_date": date(2026, 3, 11),
            "available_at": datetime(2026, 3, 12, tzinfo=UTC),
            "fatalities": 2,
            "notes": "neighbor event",
        },
    ]

    train_row = build_feature_row(
        "zone-a",
        date(2026, 3, 11),
        climate_rows=climate_rows,
        acled_events=acled_events,
        adjacency_neighbor_ids=["zone-b", "zone-c"],
        data_cutoff=cutoff,
    )
    serve_row = build_feature_row(
        "zone-a",
        date(2026, 3, 11),
        climate_rows=climate_rows,
        acled_events=acled_events,
        adjacency_neighbor_ids=["zone-b", "zone-c"],
        data_cutoff=cutoff,
    )

    assert train_row.values == serve_row.values
    assert list(train_row.values) == FEATURE_NAMES
    assert train_row.values == {
        "rain_mm": 45.0,
        "rain_lag1": 30.0,
        "rain_lag2": 10.0,
        "rain_anomaly": 25.0,
        "ndvi_mean": None,
        "ndvi_lag1": 0.30,
        "ndvi_anomaly": None,
        "incident_count_dekad": 1.0,
        "incident_count_lag1": 1.0,
        "incident_trend": 0.0,
        "neighbor_incident_mean": 0.5,
        "month_sin": pytest.approx(1.0),
        "month_cos": pytest.approx(0.0, abs=1e-12),
    }


def test_feature_names_exclude_acled_notes() -> None:
    assert all("notes" not in feature_name for feature_name in FEATURE_NAMES)
    assert "notes" not in " ".join(FEATURE_NAMES)
    assert len(FEATURE_NAMES) == len(set(FEATURE_NAMES))
    assert math.isfinite(
        build_feature_row(
            "zone-a",
            date(2026, 3, 11),
            climate_rows=[],
            acled_events=[],
            adjacency_neighbor_ids=[],
            data_cutoff=datetime(2026, 3, 12, tzinfo=UTC),
        ).values["month_sin"]
    )
