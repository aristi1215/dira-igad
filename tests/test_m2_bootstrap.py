"""M2 acceptance: bootstrap is idempotent, cross-border adjacency exists, all zones exposed."""

from __future__ import annotations

import psycopg
import pytest
from dira_data import fixtures
from dira_data.repositories import geo

pytestmark = pytest.mark.integration


def _bootstrap(conn: psycopg.Connection) -> None:
    geo.load_zones_geojson(conn, fixtures.seeded_dir() / "zones.geojson")
    geo.compute_adjacency(conn)
    geo.upsert_exposure(conn, fixtures.load_json("exposure.json"))
    geo.upsert_recipients(conn, fixtures.load_json("recipients.json"))


def _dump(conn: psycopg.Connection) -> dict[str, list]:
    out: dict[str, list] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, country, ST_AsText(geom) g FROM zones ORDER BY id")
        out["zones"] = [tuple(r.values()) for r in cur.fetchall()]
        cur.execute(
            "SELECT zone_id, neighbor_id, shares_border, round(centroid_distance_km::numeric,3),"
            " cross_border FROM zone_adjacency ORDER BY zone_id, neighbor_id"
        )
        out["adjacency"] = [tuple(r.values()) for r in cur.fetchall()]
        cur.execute("SELECT zone_id, population, households FROM zone_exposure ORDER BY zone_id")
        out["exposure"] = [tuple(r.values()) for r in cur.fetchall()]
        cur.execute("SELECT zone_id, phone FROM recipients ORDER BY phone")
        out["recipients"] = [tuple(r.values()) for r in cur.fetchall()]
    return out


def test_seed_is_idempotent(db: psycopg.Connection) -> None:
    _bootstrap(db)
    first = _dump(db)
    _bootstrap(db)  # run again
    second = _dump(db)
    assert first == second


def test_cross_border_adjacency_exists(db: psycopg.Connection) -> None:
    _bootstrap(db)
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM zone_adjacency a
            JOIN zones z1 ON z1.id = a.zone_id
            JOIN zones z2 ON z2.id = a.neighbor_id
            WHERE a.cross_border
              AND ( (z1.country='KE' AND z2.country='ET')
                 OR (z1.country='KE' AND z2.country='SO') )
            """
        )
        assert cur.fetchone()["n"] >= 1


def test_every_zone_has_exposure(db: psycopg.Connection) -> None:
    _bootstrap(db)
    with db.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS n FROM zones z "
            "LEFT JOIN zone_exposure e ON e.zone_id = z.id WHERE e.zone_id IS NULL"
        )
        assert cur.fetchone()["n"] == 0


def test_no_zone_is_neighbor_of_itself(db: psycopg.Connection) -> None:
    _bootstrap(db)
    with db.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM zone_adjacency WHERE zone_id = neighbor_id")
        assert cur.fetchone()["n"] == 0
