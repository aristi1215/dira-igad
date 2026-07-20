"""Bootstrap geography: clusters, zones, adjacency (PostGIS), exposure, recipients.

All operations are idempotent so ``make seed`` can run repeatedly to the same state.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import psycopg


def load_zones_geojson(conn: psycopg.Connection, geojson_path: Path) -> None:
    """Upsert the cluster and its zones from a GeoJSON FeatureCollection."""
    fc = json.loads(geojson_path.read_text())
    cluster = fc["cluster"]
    with conn.cursor() as cur:
        # Cluster geom = union of its zones' geoms (computed after zones load below).
        cur.execute(
            """
            INSERT INTO clusters (id, name, geom)
            VALUES (%s, %s, ST_GeomFromText('MULTIPOLYGON EMPTY', 4326))
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
            """,
            (cluster["id"], cluster["name"]),
        )
        for feat in fc["features"]:
            props = feat["properties"]
            geom_json = json.dumps(feat["geometry"])
            cur.execute(
                """
                INSERT INTO zones (id, cluster_id, name, country, geom, centroid)
                VALUES (
                    %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                )
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name, country = EXCLUDED.country,
                    geom = EXCLUDED.geom, centroid = EXCLUDED.centroid
                """,
                (props["id"], cluster["id"], props["name"], props["country"], geom_json, geom_json),
            )
        # Recompute cluster geometry as the union of its zones.
        cur.execute(
            """
            UPDATE clusters c
            SET geom = ST_Multi(sub.g)
            FROM (SELECT cluster_id, ST_Union(geom) AS g FROM zones GROUP BY cluster_id) sub
            WHERE c.id = sub.cluster_id
            """
        )
    conn.commit()


def compute_adjacency(conn: psycopg.Connection) -> None:
    """Recompute zone_adjacency with PostGIS: shares_border, centroid distance, cross_border."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM zone_adjacency")
        cur.execute(
            """
            INSERT INTO zone_adjacency (zone_id, neighbor_id, shares_border,
                                        centroid_distance_km, cross_border)
            SELECT a.id, b.id,
                   ST_Intersects(a.geom, b.geom) AS shares_border,
                   ST_Distance(a.centroid::geography, b.centroid::geography) / 1000.0 AS dist_km,
                   (a.country <> b.country) AS cross_border
            FROM zones a
            JOIN zones b ON a.id <> b.id
            WHERE ST_DWithin(a.centroid::geography, b.centroid::geography, 60000)  -- ~60km
              AND (ST_Intersects(a.geom, b.geom)
                   OR ST_DWithin(a.geom::geography, b.geom::geography, 1000))
            """
        )
    conn.commit()


def upsert_exposure(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO zone_exposure (zone_id, population, households, source)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (zone_id) DO UPDATE SET
                    population = EXCLUDED.population,
                    households = EXCLUDED.households,
                    source = EXCLUDED.source,
                    updated_at = now()
                """,
                (r["zone_id"], r["population"], r["households"], r["source"]),
            )
    conn.commit()


def load_zone_features(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Zones as GeoJSON-like features (for zonal stats / tile rendering)."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, country, ST_AsGeoJSON(geom) AS g FROM zones ORDER BY id")
        return [
            {
                "type": "Feature",
                "properties": {"id": r["id"], "name": r["name"], "country": r["country"]},
                "geometry": json.loads(r["g"]),
            }
            for r in cur.fetchall()
        ]


def zone_ids(conn: psycopg.Connection) -> list[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM zones ORDER BY id")
        return [r["id"] for r in cur.fetchall()]


def adjacency_pairs(conn: psycopg.Connection) -> list[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute("SELECT zone_id, neighbor_id FROM zone_adjacency ORDER BY zone_id, neighbor_id")
        return [(r["zone_id"], r["neighbor_id"]) for r in cur.fetchall()]


def cluster_bounds(conn: psycopg.Connection) -> tuple[float, float, float, float]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT ST_XMin(e) x0, ST_YMin(e) y0, ST_XMax(e) x1, ST_YMax(e) y1 "
            "FROM (SELECT ST_Extent(geom) e FROM zones) s"
        )
        r = cur.fetchone()
    return (r["x0"], r["y0"], r["x1"], r["y1"])


def upsert_recipients(conn: psycopg.Connection, rows: list[dict[str, Any]]) -> None:
    """Idempotent by (zone_id, phone). E.164 is enforced by the DB CHECK on insert."""
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO recipients (zone_id, name, phone, language)
                SELECT %s, %s, %s, %s
                WHERE NOT EXISTS (
                    SELECT 1 FROM recipients WHERE zone_id = %s AND phone = %s
                )
                """,
                (r["zone_id"], r.get("name"), r["phone"], r.get("language", "sw"),
                 r["zone_id"], r["phone"]),
            )
    conn.commit()
