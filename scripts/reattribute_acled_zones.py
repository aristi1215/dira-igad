"""Re-attribute NULL zone_id ACLED events via PostGIS ST_Contains."""

from __future__ import annotations

import argparse
import sys

import psycopg
from dira_data.db_url import resolve_database_url


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args(argv)
    database_url = args.database_url or resolve_database_url()

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
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
            updated = cur.rowcount
        conn.commit()
    print(f"[reattribute] updated zone_id on {updated} events")
    return 0


if __name__ == "__main__":
    sys.exit(main())
