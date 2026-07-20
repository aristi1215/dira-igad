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
