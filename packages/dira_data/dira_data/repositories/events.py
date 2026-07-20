"""ACLED conflict events. Events are immutable once ingested (ON CONFLICT DO NOTHING).

zone_id NULL is retained (out-of-cluster event); it never enters zone features. The feature
builder never reads ``notes``/``actor*`` (do-no-harm; no actor-derived features).
"""

from __future__ import annotations

from typing import Any

import psycopg

_UPSERT = """
INSERT INTO acled_events
    (event_id, event_date, zone_id, event_type, sub_event_type, fatalities,
     actor1, actor2, notes, geom, available_at)
VALUES (%(event_id)s, %(event_date)s, %(zone_id)s, %(event_type)s, %(sub_event_type)s,
        %(fatalities)s, %(actor1)s, %(actor2)s, %(notes)s,
        ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), %(available_at)s)
ON CONFLICT (event_id) DO NOTHING
"""


def upsert_events(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    norm = []
    for r in rows:
        r = dict(r)
        r["zone_id"] = r.get("zone_id") or None
        r["sub_event_type"] = r.get("sub_event_type") or None
        norm.append(r)
    with conn.cursor() as cur:
        cur.executemany(_UPSERT, norm)


def read_all(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """All events (zone_id, event_date, fatalities, available_at) — never notes/actors."""
    with conn.cursor() as cur:
        cur.execute("SELECT zone_id, event_date, fatalities, available_at FROM acled_events")
        return [dict(r) for r in cur.fetchall()]


def assign_event_zones(conn: psycopg.Connection) -> None:
    """Spatially assign zone_id to events that lack one (live rows arrive without it).

    Events outside every zone keep zone_id NULL — retained, never entering zone features.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE acled_events e
            SET zone_id = z.id
            FROM zones z
            WHERE e.zone_id IS NULL
              AND e.geom IS NOT NULL
              AND ST_Contains(z.geom, e.geom)
            """
        )
