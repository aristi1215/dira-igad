"""Bitemporal climate observations (invariant 2). First-write-wins per column group.

Once ``rain_available_at`` (resp. ``ndvi_available_at``) is set it is NEVER overwritten, so a
value that was knowable at a given cutoff stays identical forever — training and inference
see the same cut. A column group that is still NULL can be filled in by a later cycle.
"""

from __future__ import annotations

from typing import Any

import psycopg

_UPSERT = """
INSERT INTO zone_climate_dekadal
    (zone_id, dekad_start, rain_mm, rain_anomaly, rain_available_at,
     ndvi, ndvi_anomaly, ndvi_available_at)
VALUES (%(zone_id)s, %(dekad_start)s, %(rain_mm)s, %(rain_anomaly)s, %(rain_available_at)s,
        %(ndvi)s, %(ndvi_anomaly)s, %(ndvi_available_at)s)
ON CONFLICT (zone_id, dekad_start) DO UPDATE SET
    -- Rain group: fill only if not already known (existing available_at IS NULL).
    rain_mm = CASE WHEN zone_climate_dekadal.rain_available_at IS NULL
                   THEN EXCLUDED.rain_mm ELSE zone_climate_dekadal.rain_mm END,
    rain_anomaly = CASE WHEN zone_climate_dekadal.rain_available_at IS NULL
                        THEN EXCLUDED.rain_anomaly ELSE zone_climate_dekadal.rain_anomaly END,
    rain_available_at = CASE WHEN zone_climate_dekadal.rain_available_at IS NULL
                             THEN EXCLUDED.rain_available_at
                             ELSE zone_climate_dekadal.rain_available_at END,
    -- NDVI group: independent of the rain group.
    ndvi = CASE WHEN zone_climate_dekadal.ndvi_available_at IS NULL
                THEN EXCLUDED.ndvi ELSE zone_climate_dekadal.ndvi END,
    ndvi_anomaly = CASE WHEN zone_climate_dekadal.ndvi_available_at IS NULL
                        THEN EXCLUDED.ndvi_anomaly ELSE zone_climate_dekadal.ndvi_anomaly END,
    ndvi_available_at = CASE WHEN zone_climate_dekadal.ndvi_available_at IS NULL
                             THEN EXCLUDED.ndvi_available_at
                             ELSE zone_climate_dekadal.ndvi_available_at END
"""


def upsert_climate(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    """First-write-wins upsert of dekadal climate rows. Does not commit (caller controls Tx)."""
    if not rows:
        return
    with conn.cursor() as cur:
        cur.executemany(_UPSERT, rows)
