"""Backfill CHIRPS rain + GEE NDVI onto dira_live for a dekadal range.

Usage:
  DATA_MODE=live uv run python -m scripts.backfill_climate \\
    --start 2012-01-01 --end 2025-03-21

Idempotent and resumable: cached CHIRPS TIFFs are reused; dekads that already
have rain+ndvi for every zone are skipped; empty fetches never clear existing
values.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date
from typing import Any

from dira_core.time import iter_dekads, previous_dekad, validate_dekad_start
from dira_data.climate import upsert_climate_first_write_wins
from dira_data.db import connect, load_zone_geoms_geojson, load_zones
from dira_data.db_url import resolve_database_url
from dira_data.ndvi_gee import (
    CombinedClimateAdapter,
    FallbackRainAdapter,
    GeeChirpsAdapter,
    GeeNdviAdapter,
)
from dira_data.rasters import ChirpsHttpAdapter

from scripts.env_load import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger("dira.backfill_climate")


def _latest_complete_dekad(today: date | None = None) -> date:
    today = today or date.today()
    if today.day >= 21:
        current = date(today.year, today.month, 21)
    elif today.day >= 11:
        current = date(today.year, today.month, 11)
    else:
        current = date(today.year, today.month, 1)
    return previous_dekad(current)


def _dekad_complete(
    conn: Any,
    dekad: date,
    *,
    n_zones: int,
    rain_only: bool,
    ndvi_only: bool,
) -> bool:
    with conn.cursor() as cur:
        if rain_only:
            cur.execute(
                """
                SELECT count(*) FILTER (WHERE rain_mm IS NOT NULL) AS filled
                FROM zone_climate_dekadal WHERE dekad_start = %s
                """,
                (dekad,),
            )
        elif ndvi_only:
            cur.execute(
                """
                SELECT count(*) FILTER (WHERE ndvi_mean IS NOT NULL) AS filled
                FROM zone_climate_dekadal WHERE dekad_start = %s
                """,
                (dekad,),
            )
        else:
            cur.execute(
                """
                SELECT count(*) FILTER (
                    WHERE rain_mm IS NOT NULL AND ndvi_mean IS NOT NULL
                ) AS filled
                FROM zone_climate_dekadal WHERE dekad_start = %s
                """,
                (dekad,),
            )
        row = cur.fetchone()
        filled = int(row["filled"] if isinstance(row, dict) else row[0])
    return filled >= n_zones


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2012-01-01")
    parser.add_argument(
        "--end",
        default=None,
        help="Dekad start YYYY-MM-DD (default: latest complete)",
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--rain-only", action="store_true")
    parser.add_argument("--ndvi-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Optional max dekads (smoke tests)")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch even when the dekad already looks complete",
    )
    parser.add_argument(
        "--gee-rain",
        action="store_true",
        help="Use Earth Engine CHIRPS only (skip HTTP UCSB downloads)",
    )
    args = parser.parse_args(argv)

    load_dotenv()
    os.environ.setdefault("DATA_MODE", "live")
    database_url = args.database_url or resolve_database_url(data_mode="live")
    start = validate_dekad_start(date.fromisoformat(args.start))
    end = validate_dekad_start(
        date.fromisoformat(args.end) if args.end else _latest_complete_dekad()
    )
    dekads = iter_dekads(start, end)
    if args.limit and args.limit > 0:
        dekads = dekads[: args.limit]

    logger.info("Backfill %s dekads %s → %s into %s", len(dekads), start, end, database_url)

    with connect(database_url) as conn:
        zones = load_zones(conn)
        zone_ids = [str(z["id"]) for z in zones]
        geoms = load_zone_geoms_geojson(conn)

    http_rain = ChirpsHttpAdapter(zone_geoms_geojson=geoms)
    gee_rain = GeeChirpsAdapter(zone_geoms_geojson=geoms)
    rain = gee_rain if args.gee_rain else FallbackRainAdapter(http_rain, gee_rain)
    ndvi = GeeNdviAdapter(zone_geoms_geojson=geoms)
    if args.rain_only:
        hazard = rain
    elif args.ndvi_only:
        hazard = ndvi
    else:
        hazard = CombinedClimateAdapter(rain, ndvi)

    ok = 0
    skipped = 0
    failed = 0
    for i, dekad in enumerate(dekads, start=1):
        try:
            if not args.force:
                with connect(database_url) as conn:
                    if _dekad_complete(
                        conn,
                        dekad,
                        n_zones=len(zone_ids),
                        rain_only=args.rain_only,
                        ndvi_only=args.ndvi_only,
                    ):
                        skipped += 1
                        if i % 36 == 0 or i == len(dekads):
                            logger.info(
                                "[%s/%s] %s skip (already complete)",
                                i,
                                len(dekads),
                                dekad,
                            )
                        continue

            fetched = hazard.fetch_dekadal(zone_ids, dekad)
            rows = []
            for zid, vals in fetched.items():
                rows.append(
                    {
                        "zone_id": zid,
                        "dekad_start": dekad,
                        "rain_mm": vals.get("rain_mm"),
                        "rain_available_at": vals.get("rain_available_at"),
                        "ndvi_mean": vals.get("ndvi_mean"),
                        "ndvi_available_at": vals.get("ndvi_available_at"),
                    }
                )
            if not rows:
                failed += 1
                logger.warning(
                    "[%s/%s] %s empty fetch — leaving existing rows untouched",
                    i,
                    len(dekads),
                    dekad,
                )
                continue

            with connect(database_url) as conn:
                with conn.cursor() as cur:
                    # Clear observation groups so FWW can write live values.
                    if not args.ndvi_only:
                        cur.execute(
                            """
                            UPDATE zone_climate_dekadal
                            SET rain_mm = NULL, rain_available_at = NULL
                            WHERE dekad_start = %s
                            """,
                            (dekad,),
                        )
                    if not args.rain_only:
                        cur.execute(
                            """
                            UPDATE zone_climate_dekadal
                            SET ndvi_mean = NULL, ndvi_available_at = NULL
                            WHERE dekad_start = %s
                            """,
                            (dekad,),
                        )
                upsert_climate_first_write_wins(conn, rows)
            ok += 1
            if i % 12 == 0 or i == len(dekads):
                logger.info("[%s/%s] %s rows=%s", i, len(dekads), dekad, len(rows))
        except Exception as exc:  # noqa: BLE001
            failed += 1
            logger.exception("Dekad %s failed: %s", dekad, exc)

    logger.info("Done. ok=%s skipped=%s failed=%s", ok, skipped, failed)
    return 1 if failed and ok == 0 and skipped == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
