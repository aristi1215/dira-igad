"""ACLED upsert with PostGIS point-in-polygon zone attribution."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Sequence

from dira_core.ports import ConflictEvent

UPSERT_ACLED_SQL = """
WITH point_value AS (
  SELECT ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326) AS geom
),
zone_match AS (
  SELECT z.id
  FROM zones z, point_value p
  WHERE ST_Contains(z.geom, p.geom)
  ORDER BY z.id
  LIMIT 1
)
INSERT INTO acled_events (
  event_id, event_date, zone_id, event_type, fatalities,
  actor1, actor2, notes, geom, available_at, source
)
SELECT
  %(event_id)s,
  %(event_date)s,
  COALESCE(%(zone_id)s, (SELECT id FROM zone_match)),
  %(event_type)s,
  %(fatalities)s,
  %(actor1)s,
  %(actor2)s,
  %(notes)s,
  (SELECT geom FROM point_value),
  %(available_at)s,
  'acled'
FROM point_value
ON CONFLICT (event_id) DO UPDATE SET
  event_date = EXCLUDED.event_date,
  zone_id = COALESCE(EXCLUDED.zone_id, acled_events.zone_id),
  event_type = EXCLUDED.event_type,
  fatalities = EXCLUDED.fatalities,
  actor1 = EXCLUDED.actor1,
  actor2 = EXCLUDED.actor2,
  notes = EXCLUDED.notes,
  geom = COALESCE(EXCLUDED.geom, acled_events.geom),
  available_at = LEAST(acled_events.available_at, EXCLUDED.available_at),
  source = EXCLUDED.source
"""


def upsert_acled_events(conn: Any, events: Sequence[ConflictEvent]) -> dict[str, int]:
    """Insert/update ACLED events, attributing zone via ST_Contains when lon/lat exist."""
    upserted = 0
    skipped = 0
    with conn.cursor() as cur:
        for ev in events:
            if ev.lon is None or ev.lat is None:
                skipped += 1
                continue
            available_at = ev.available_at or datetime.combine(
                ev.event_date, datetime.min.time(), tzinfo=UTC
            )
            cur.execute(
                UPSERT_ACLED_SQL,
                {
                    "lon": ev.lon,
                    "lat": ev.lat,
                    "event_id": ev.event_id,
                    "event_date": ev.event_date,
                    "zone_id": ev.zone_id,
                    "event_type": ev.event_type,
                    "fatalities": ev.fatalities,
                    "actor1": ev.actor1,
                    "actor2": ev.actor2,
                    "notes": ev.notes,
                    "available_at": available_at,
                },
            )
            upserted += 1
    return {"upserted": upserted, "skipped_no_coords": skipped}
