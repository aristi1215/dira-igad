"""`make seed` — bootstrap geography + exposure + recipients from the seeded fixtures.

Idempotent by construction: geometry/exposure upsert on conflict, adjacency is recomputed,
recipients insert-if-absent. Historical observations (climate/ACLED/news) are ingested by
the pipeline's E1 stage from the same committed fixtures, so seeding stays purely structural.
"""

from __future__ import annotations

import sys

from dira_data import fixtures
from dira_data.db import connect
from dira_data.repositories import geo
from dira_data.schema import ensure_schema


def run() -> int:
    conn = connect(autocommit=False)
    try:
        ensure_schema(conn)
        geo.load_zones_geojson(conn, fixtures.seeded_dir() / "zones.geojson")
        geo.compute_adjacency(conn)
        geo.upsert_exposure(conn, fixtures.load_json("exposure.json"))
        geo.upsert_recipients(conn, fixtures.load_json("recipients.json"))
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM zones")
            zones = cur.fetchone()["n"]
            cur.execute("SELECT count(*) AS n FROM zone_adjacency WHERE cross_border")
            xborder = cur.fetchone()["n"]
        print(f"[seed] zones={zones} cross_border_adjacency_pairs={xborder}")
        return 0
    finally:
        conn.close()


def main() -> int:
    return run()


if __name__ == "__main__":
    sys.exit(main())
