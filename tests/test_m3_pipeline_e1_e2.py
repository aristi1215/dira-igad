"""M3 acceptance: E1 ingest is idempotent and bitemporal (first-write-wins); E2 renders tiles.

All tests run against a real Postgres. The dekad CHECK is exercised directly.
"""

from __future__ import annotations

from datetime import datetime

import psycopg
import pytest
from dira_data import fixtures
from dira_data.repositories import geo
from dira_worker import pipeline
from dira_worker.cycle import data_cutoff

pytestmark = pytest.mark.integration


def _bootstrap(conn: psycopg.Connection) -> None:
    geo.load_zones_geojson(conn, fixtures.seeded_dir() / "zones.geojson")
    geo.compute_adjacency(conn)
    geo.upsert_exposure(conn, fixtures.load_json("exposure.json"))


def _dump_climate(conn: psycopg.Connection) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT zone_id, dekad_start, rain_mm, rain_available_at, ndvi, ndvi_available_at "
            "FROM zone_climate_dekadal ORDER BY zone_id, dekad_start"
        )
        return [tuple(r.values()) for r in cur.fetchall()]


def _run_e1_e2(conn: psycopg.Connection, cutoff: datetime) -> pipeline.PipelineResult:
    result = pipeline.PipelineResult(cycle=cutoff.date(), cutoff=cutoff)
    pipeline.stage_e1_ingest(conn, cutoff, result)
    pipeline.stage_e2_tiles(conn, cutoff, result)
    return result


def test_e1_e2_rerun_is_idempotent(db: psycopg.Connection, tmp_path, monkeypatch) -> None:
    from datetime import date

    monkeypatch.setenv("DIRA_TILES_DIR", str(tmp_path))
    _bootstrap(db)
    cutoff = data_cutoff(date(2026, 1, 1))
    _run_e1_e2(db, cutoff)
    first = _dump_climate(db)
    _run_e1_e2(db, cutoff)
    second = _dump_climate(db)
    assert first == second and len(first) > 0


def test_upsert_does_not_overwrite_existing_rain_available_at(db: psycopg.Connection) -> None:
    from datetime import date

    _bootstrap(db)
    early = data_cutoff(date(2020, 1, 1))
    _run_e1_e2(db, early)
    with db.cursor() as cur:
        cur.execute(
            "SELECT rain_available_at FROM zone_climate_dekadal "
            "WHERE rain_available_at IS NOT NULL ORDER BY dekad_start LIMIT 1"
        )
        before = cur.fetchone()["rain_available_at"]
    # Re-ingest at a much later cutoff (values are identical fixtures) — must not change it.
    _run_e1_e2(db, data_cutoff(date(2026, 1, 1)))
    with db.cursor() as cur:
        cur.execute(
            "SELECT rain_available_at FROM zone_climate_dekadal "
            "WHERE dekad_start = (SELECT min(dekad_start) FROM zone_climate_dekadal "
            "WHERE rain_available_at IS NOT NULL) ORDER BY zone_id LIMIT 1"
        )
        after = cur.fetchone()["rain_available_at"]
    assert before == after


def test_ndvi_filled_in_later_cycle_without_touching_rain(db: psycopg.Connection) -> None:
    from datetime import timedelta

    _bootstrap(db)
    # Find a dekad whose rain becomes available strictly before its NDVI.
    row = fixtures.load_csv("climate_dekadal.csv")[0]
    from dateutil import parser as dtparse

    rain_at = dtparse.isoparse(row["rain_available_at"])
    ndvi_at = dtparse.isoparse(row["ndvi_available_at"])
    assert rain_at < ndvi_at  # fixture design: NDVI lags rain
    # Cutoff between rain and ndvi availability: rain present, ndvi NULL.
    mid = rain_at + (ndvi_at - rain_at) / 2
    _run_e1_e2(db, mid)
    with db.cursor() as cur:
        cur.execute(
            "SELECT rain_mm, rain_available_at, ndvi, ndvi_available_at FROM zone_climate_dekadal "
            "WHERE zone_id=%s AND dekad_start=%s",
            (row["zone_id"], row["dekad_start"]),
        )
        r1 = cur.fetchone()
    assert r1["rain_mm"] is not None and r1["ndvi"] is None
    rain_at_before = r1["rain_available_at"]
    # Later cutoff: NDVI arrives; rain group untouched.
    _run_e1_e2(db, ndvi_at + timedelta(days=1))
    with db.cursor() as cur:
        cur.execute(
            "SELECT rain_available_at, ndvi, ndvi_available_at FROM zone_climate_dekadal "
            "WHERE zone_id=%s AND dekad_start=%s",
            (row["zone_id"], row["dekad_start"]),
        )
        r2 = cur.fetchone()
    assert r2["ndvi"] is not None
    assert r2["rain_available_at"] == rain_at_before  # rain group unchanged


def test_dekad_check_rejects_day_15(db: psycopg.Connection) -> None:
    _bootstrap(db)
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO zone_climate_dekadal "
                "(zone_id, dekad_start, rain_mm, rain_available_at)"
                " VALUES (%s, %s, 1.0, now())",
                ("z_ke_mandera_town", "2026-01-15"),
            )
    db.rollback()


def test_out_of_zone_event_retained_with_null_zone(db: psycopg.Connection) -> None:
    from datetime import date

    _bootstrap(db)
    _run_e1_e2(db, data_cutoff(date(2026, 1, 1)))
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM acled_events WHERE zone_id IS NULL")
        assert cur.fetchone()["n"] >= 1


def test_e2_writes_png_tiles(db: psycopg.Connection, tmp_path, monkeypatch) -> None:
    from datetime import date

    monkeypatch.setenv("DIRA_TILES_DIR", str(tmp_path))
    _bootstrap(db)
    result = _run_e1_e2(db, data_cutoff(date(2026, 1, 1)))
    tiles = result.stats["e2"]["tiles"]
    assert tiles and all(t.endswith(".png") for t in tiles)
    for t in tiles:
        with open(t, "rb") as fh:
            assert fh.read(8) == b"\x89PNG\r\n\x1a\n"
