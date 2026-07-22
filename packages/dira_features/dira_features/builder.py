"""Bitemporal feature construction for training and inference."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime

from dira_core.ports import FeatureRow
from dira_core.time import dekad_end, previous_dekad, validate_dekad_start

ClimateRow = Mapping[str, object]
AcledEvent = Mapping[str, object]

FEATURE_NAMES: list[str] = [
    "rain_mm",
    "rain_lag1",
    "rain_lag2",
    "rain_anomaly",
    "ndvi_mean",
    "ndvi_lag1",
    "ndvi_anomaly",
    "incident_count_dekad",
    "incident_count_lag1",
    "incident_trend",
    "neighbor_incident_mean",
    "month_sin",
    "month_cos",
]


def build_feature_row(
    zone_id: str,
    dekad_start: date,
    *,
    climate_rows: Sequence[ClimateRow],
    acled_events: Sequence[AcledEvent],
    adjacency_neighbor_ids: Sequence[str],
    data_cutoff: datetime,
) -> FeatureRow:
    """Build one zone x dekad feature vector with a strict bitemporal cut."""

    validate_dekad_start(dekad_start)
    lag1_start = previous_dekad(dekad_start)
    lag2_start = previous_dekad(lag1_start)

    rain_mm = _climate_value(
        climate_rows, zone_id, dekad_start, "rain_mm", "rain_available_at", data_cutoff
    )
    rain_lag1 = _climate_value(
        climate_rows, zone_id, lag1_start, "rain_mm", "rain_available_at", data_cutoff
    )
    rain_lag2 = _climate_value(
        climate_rows, zone_id, lag2_start, "rain_mm", "rain_available_at", data_cutoff
    )
    rain_anomaly = _anomaly(
        rain_mm,
        _trailing_mean(
            climate_rows, zone_id, dekad_start, "rain_mm", "rain_available_at", data_cutoff
        ),
    )

    ndvi_mean = _climate_value(
        climate_rows, zone_id, dekad_start, "ndvi_mean", "ndvi_available_at", data_cutoff
    )
    ndvi_lag1 = _climate_value(
        climate_rows, zone_id, lag1_start, "ndvi_mean", "ndvi_available_at", data_cutoff
    )
    ndvi_anomaly = _anomaly(
        ndvi_mean,
        _trailing_mean(
            climate_rows, zone_id, dekad_start, "ndvi_mean", "ndvi_available_at", data_cutoff
        ),
    )

    incident_count = float(_incident_count(acled_events, zone_id, dekad_start, data_cutoff))
    incident_lag1 = float(_incident_count(acled_events, zone_id, lag1_start, data_cutoff))
    incident_trend = incident_count - incident_lag1
    neighbor_incident_mean = _neighbor_incident_mean(
        acled_events, adjacency_neighbor_ids, dekad_start, data_cutoff
    )

    month_angle = 2.0 * math.pi * dekad_start.month / 12.0
    values = {
        "rain_mm": rain_mm,
        "rain_lag1": rain_lag1,
        "rain_lag2": rain_lag2,
        "rain_anomaly": rain_anomaly,
        "ndvi_mean": ndvi_mean,
        "ndvi_lag1": ndvi_lag1,
        "ndvi_anomaly": ndvi_anomaly,
        "incident_count_dekad": incident_count,
        "incident_count_lag1": incident_lag1,
        "incident_trend": incident_trend,
        "neighbor_incident_mean": neighbor_incident_mean,
        "month_sin": math.sin(month_angle),
        "month_cos": math.cos(month_angle),
    }
    return FeatureRow(zone_id=zone_id, dekad_start=dekad_start, values=values)


def _climate_value(
    rows: Sequence[ClimateRow],
    zone_id: str,
    dekad_start: date,
    value_key: str,
    available_key: str,
    data_cutoff: datetime,
) -> float | None:
    for row in rows:
        if row.get("zone_id") != zone_id:
            continue
        if _as_date(row.get("dekad_start"), "dekad_start") != dekad_start:
            continue
        if not _available_by(row.get(available_key), data_cutoff):
            return None
        return _optional_float(row.get(value_key))
    return None


def _trailing_mean(
    rows: Sequence[ClimateRow],
    zone_id: str,
    dekad_start: date,
    value_key: str,
    available_key: str,
    data_cutoff: datetime,
) -> float | None:
    values: list[float] = []
    for row in rows:
        if row.get("zone_id") != zone_id:
            continue
        row_dekad = _as_date(row.get("dekad_start"), "dekad_start")
        if row_dekad >= dekad_start:
            continue
        if not _available_by(row.get(available_key), data_cutoff):
            continue
        value = _optional_float(row.get(value_key))
        if value is not None:
            values.append(value)
    if not values:
        return None
    return sum(values) / len(values)


def _anomaly(value: float | None, baseline: float | None) -> float | None:
    if value is None or baseline is None:
        return None
    return value - baseline


def _incident_count(
    events: Sequence[AcledEvent],
    zone_id: str,
    dekad_start: date,
    data_cutoff: datetime,
) -> int:
    end = dekad_end(dekad_start)
    count = 0
    for event in events:
        if event.get("zone_id") != zone_id:
            continue
        if not _available_by(event.get("available_at"), data_cutoff):
            continue
        event_date = _as_date(event.get("event_date"), "event_date")
        if dekad_start <= event_date <= end:
            count += 1
    return count


def _neighbor_incident_mean(
    events: Sequence[AcledEvent],
    neighbor_ids: Sequence[str],
    dekad_start: date,
    data_cutoff: datetime,
) -> float | None:
    unique_neighbor_ids = list(dict.fromkeys(neighbor_ids))
    if not unique_neighbor_ids:
        return None
    counts = [
        _incident_count(events, neighbor_id, dekad_start, data_cutoff)
        for neighbor_id in unique_neighbor_ids
    ]
    return float(sum(counts) / len(counts))


def _available_by(value: object, data_cutoff: datetime) -> bool:
    if value is None:
        return False
    available_at = _as_datetime(value, "available_at")
    return _comparable_datetime(available_at) <= _comparable_datetime(data_cutoff)


def _comparable_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _as_date(value: object, field_name: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raise TypeError(f"{field_name} must be a date")


def _as_datetime(value: object, field_name: str) -> datetime:
    if isinstance(value, datetime):
        return value
    raise TypeError(f"{field_name} must be a datetime")


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise TypeError("boolean values are not valid numeric features")
    if isinstance(value, int | float):
        return float(value)
    raise TypeError("feature values must be numeric or None")
