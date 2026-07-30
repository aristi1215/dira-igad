"""Populate dira_live with ACLED history + information-layer live feeds.

By default copies ACLED rows from the seeded/local DB (already ingested live
history) for speed, then refreshes HAPI/ReliefWeb/GDELT/GDACS into dira_live.
Pass --fetch-acled to force a fresh ACLED API pull instead.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

from dira_core.ports import ConflictEvent
from dira_data.acled_ingest import upsert_acled_events
from dira_data.adapters import get_conflict_source
from dira_data.db import connect, load_zones
from dira_data.db_url import resolve_database_url
from dira_data.live import refresh_information_layer_live
from scripts.env_load import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("dira.live_sync")


def _copy_acled_from(source_url: str, target_url: str) -> dict[str, int]:
    with connect(source_url) as src:
        with src.cursor() as cur:
            cur.execute(
                """
                SELECT event_id, event_date, zone_id, event_type, fatalities,
                       actor1, actor2, notes, ST_X(geom) AS lon, ST_Y(geom) AS lat,
                       available_at
                FROM acled_events
                WHERE geom IS NOT NULL
                """
            )
            rows = cur.fetchall()
    events = [
        ConflictEvent(
            event_id=str(r["event_id"]),
            event_date=r["event_date"],
            zone_id=r.get("zone_id"),
            event_type=str(r["event_type"]),
            fatalities=int(r.get("fatalities") or 0),
            notes=r.get("notes"),
            actor1=r.get("actor1"),
            actor2=r.get("actor2"),
            lon=float(r["lon"]) if r.get("lon") is not None else None,
            lat=float(r["lat"]) if r.get("lat") is not None else None,
            available_at=r.get("available_at"),
        )
        for r in rows
    ]
    with connect(target_url) as dst:
        return upsert_acled_events(dst, events)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--since", default="2012-01-01")
    parser.add_argument(
        "--copy-acled-from",
        default=None,
        help="Source DATABASE_URL to copy ACLED from (default: DATABASE_URL_SEEDED).",
    )
    parser.add_argument(
        "--fetch-acled",
        action="store_true",
        help="Fetch ACLED from the live API instead of copying.",
    )
    args = parser.parse_args(argv)

    load_dotenv()
    os.environ["DATA_MODE"] = "live"
    database_url = args.database_url or resolve_database_url(data_mode="live")
    since = date.fromisoformat(args.since)

    with connect(database_url) as conn:
        zones = load_zones(conn)
        zone_ids = [str(z["id"]) for z in zones]

    if args.fetch_acled:
        conflict = get_conflict_source("live")
        logger.info("Fetching ACLED since %s for %s zones…", since, len(zone_ids))
        events = conflict.events(zone_ids, since=since)
        with connect(database_url) as conn:
            stats = upsert_acled_events(conn, events)
        logger.info("ACLED upsert: %s", stats)
    else:
        source = (
            args.copy_acled_from
            or os.environ.get("DATABASE_URL_SEEDED")
            or "postgresql://dira:dira@localhost:55432/dira"
        )
        logger.info("Copying ACLED from %s → %s", source, database_url)
        stats = _copy_acled_from(source, database_url)
        logger.info("ACLED copy upsert: %s", stats)

    with connect(database_url) as conn:
        with conn.cursor() as cur:
            live_counts = refresh_information_layer_live(cur)
            cur.execute(
                """
                UPDATE acled_events ae
                SET zone_id = m.id
                FROM (
                  SELECT DISTINCT ON (ae.event_id) ae.event_id, z.id
                  FROM acled_events ae
                  JOIN zones z ON ST_Contains(z.geom, ae.geom)
                  WHERE ae.zone_id IS NULL AND ae.geom IS NOT NULL
                  ORDER BY ae.event_id, z.id
                ) m
                WHERE ae.event_id = m.event_id
                """
            )
            reattr = cur.rowcount
            conn.commit()
        logger.info("Information layer: %s; reattributed=%s", live_counts, reattr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
