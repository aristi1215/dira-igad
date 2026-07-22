"""Climate persistence helpers."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from psycopg import Connection

CLIMATE_FIRST_WRITE_WINS_SQL = """
INSERT INTO zone_climate_dekadal (
  zone_id,
  dekad_start,
  rain_mm,
  rain_available_at,
  ndvi_mean,
  ndvi_available_at
)
VALUES (
  %(zone_id)s,
  %(dekad_start)s,
  %(rain_mm)s,
  %(rain_available_at)s,
  %(ndvi_mean)s,
  %(ndvi_available_at)s
)
ON CONFLICT (zone_id, dekad_start) DO UPDATE
SET rain_mm = CASE
      WHEN zone_climate_dekadal.rain_available_at IS NULL
      THEN EXCLUDED.rain_mm
      ELSE zone_climate_dekadal.rain_mm
    END,
    rain_available_at = COALESCE(
      zone_climate_dekadal.rain_available_at,
      EXCLUDED.rain_available_at
    ),
    ndvi_mean = CASE
      WHEN zone_climate_dekadal.ndvi_available_at IS NULL
      THEN EXCLUDED.ndvi_mean
      ELSE zone_climate_dekadal.ndvi_mean
    END,
    ndvi_available_at = COALESCE(
      zone_climate_dekadal.ndvi_available_at,
      EXCLUDED.ndvi_available_at
    )
"""


def upsert_climate_first_write_wins(
    conn: Connection[Any], rows: Iterable[Mapping[str, Any]]
) -> None:
    """Upsert dekadal climate using first-write-wins per observation group."""

    with conn.cursor() as cur:
        cur.executemany(CLIMATE_FIRST_WRITE_WINS_SQL, list(rows))
