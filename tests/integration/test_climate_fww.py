from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Any

import psycopg
import pytest
from dira_data.climate import upsert_climate_first_write_wins

pytestmark = pytest.mark.integration


def test_climate_upsert_same_cycle_no_row_changes(db_conn, first_zone_id) -> None:
    row = {
        "zone_id": first_zone_id,
        "dekad_start": date(2035, 1, 1),
        "rain_mm": 12.5,
        "rain_available_at": datetime(2035, 1, 3, tzinfo=UTC),
        "ndvi_mean": 0.31,
        "ndvi_available_at": datetime(2035, 1, 4, tzinfo=UTC),
    }
    upsert_climate_first_write_wins(db_conn, [row])
    db_conn.commit()
    before = _hash_climate_rows(db_conn, first_zone_id, row["dekad_start"])

    upsert_climate_first_write_wins(db_conn, [row])
    db_conn.commit()
    after = _hash_climate_rows(db_conn, first_zone_id, row["dekad_start"])

    assert after == before


def test_upsert_does_not_modify_preexisting_rain_available_at(db_conn, first_zone_id) -> None:
    cycle = date(2035, 1, 11)
    first_rain_at = datetime(2035, 1, 12, 9, tzinfo=UTC)
    upsert_climate_first_write_wins(
        db_conn,
        [
            {
                "zone_id": first_zone_id,
                "dekad_start": cycle,
                "rain_mm": 5.0,
                "rain_available_at": first_rain_at,
                "ndvi_mean": None,
                "ndvi_available_at": None,
            }
        ],
    )
    upsert_climate_first_write_wins(
        db_conn,
        [
            {
                "zone_id": first_zone_id,
                "dekad_start": cycle,
                "rain_mm": 99.0,
                "rain_available_at": datetime(2035, 1, 13, 9, tzinfo=UTC),
                "ndvi_mean": None,
                "ndvi_available_at": None,
            }
        ],
    )
    db_conn.commit()

    row = _climate_row(db_conn, first_zone_id, cycle)
    assert float(row["rain_mm"]) == 5.0
    assert row["rain_available_at"] == first_rain_at


def test_ndvi_can_complete_later_without_touching_rain_group(db_conn, first_zone_id) -> None:
    cycle = date(2035, 1, 21)
    rain_at = datetime(2035, 1, 22, 9, tzinfo=UTC)
    upsert_climate_first_write_wins(
        db_conn,
        [
            {
                "zone_id": first_zone_id,
                "dekad_start": cycle,
                "rain_mm": 7.0,
                "rain_available_at": rain_at,
                "ndvi_mean": None,
                "ndvi_available_at": None,
            }
        ],
    )
    upsert_climate_first_write_wins(
        db_conn,
        [
            {
                "zone_id": first_zone_id,
                "dekad_start": cycle,
                "rain_mm": 88.0,
                "rain_available_at": datetime(2035, 1, 23, 9, tzinfo=UTC),
                "ndvi_mean": 0.42,
                "ndvi_available_at": datetime(2035, 1, 24, 9, tzinfo=UTC),
            }
        ],
    )
    db_conn.commit()

    row = _climate_row(db_conn, first_zone_id, cycle)
    assert float(row["rain_mm"]) == 7.0
    assert row["rain_available_at"] == rain_at
    assert float(row["ndvi_mean"]) == 0.42
    assert row["ndvi_available_at"] == datetime(2035, 1, 24, 9, tzinfo=UTC)


def test_check_rejects_day_15(db_conn, first_zone_id) -> None:
    with pytest.raises(psycopg.IntegrityError):
        upsert_climate_first_write_wins(
            db_conn,
            [
                {
                    "zone_id": first_zone_id,
                    "dekad_start": date(2035, 2, 15),
                    "rain_mm": 1.0,
                    "rain_available_at": datetime(2035, 2, 16, tzinfo=UTC),
                    "ndvi_mean": None,
                    "ndvi_available_at": None,
                }
            ],
        )
        db_conn.commit()
    db_conn.rollback()


def _climate_row(db_conn: Any, zone_id: str, cycle: date) -> dict[str, Any]:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT zone_id, dekad_start, rain_mm, rain_available_at, ndvi_mean, ndvi_available_at
            FROM zone_climate_dekadal
            WHERE zone_id = %s AND dekad_start = %s
            """,
            (zone_id, cycle),
        )
        row = cur.fetchone()
    assert row is not None
    return dict(row)


def _hash_climate_rows(db_conn: Any, zone_id: str, cycle: date) -> str:
    row = _climate_row(db_conn, zone_id, cycle)
    payload = json.dumps(row, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()
