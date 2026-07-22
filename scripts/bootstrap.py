from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

import psycopg

ROOT = Path(__file__).resolve().parents[1]
SEEDED = ROOT / "data" / "seeded"
RECIPIENT_NAMESPACE = uuid.UUID("5e3d0cf4-bc70-4d48-9df7-c227f1895c0c")
SEEDED_EXPOSURE_UPDATED_AT = "2026-03-21T09:00:00Z"


def load_json(relative_path: str) -> Any:
    return json.loads((SEEDED / relative_path).read_text(encoding="utf-8"))


def upsert_clusters(cur: psycopg.Cursor[Any], clusters: list[dict[str, Any]]) -> None:
    for cluster in clusters:
        upsert_cluster(cur, cluster)


def upsert_cluster(cur: psycopg.Cursor[Any], cluster: dict[str, Any]) -> None:
    cur.execute(
        """
        INSERT INTO clusters (id, name, description)
        VALUES (%s, %s, %s)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description
        """,
        (cluster["id"], cluster["name"], cluster.get("description")),
    )


def upsert_zones(cur: psycopg.Cursor[Any], zones_geojson: dict[str, Any]) -> list[str]:
    zone_ids: list[str] = []
    for feature in zones_geojson["features"]:
        properties = feature["properties"]
        zone_ids.append(properties["id"])
        cur.execute(
            """
            WITH geom_value AS (
              SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geometry(MultiPolygon, 4326)
                AS geom
            )
            INSERT INTO zones (id, cluster_id, name, country_iso2, geom, centroid)
            SELECT %s, %s, %s, %s, geom, ST_Centroid(geom)
            FROM geom_value
            ON CONFLICT (id) DO UPDATE
            SET cluster_id = EXCLUDED.cluster_id,
                name = EXCLUDED.name,
                country_iso2 = EXCLUDED.country_iso2,
                geom = EXCLUDED.geom,
                centroid = ST_Centroid(EXCLUDED.geom)
            """,
            (
                json.dumps(feature["geometry"]),
                properties["id"],
                properties["cluster_id"],
                properties["name"],
                properties["country_iso2"],
            ),
        )
    return zone_ids


def recompute_adjacency(cur: psycopg.Cursor[Any], zone_ids: list[str]) -> int:
    cur.execute(
        "DELETE FROM zone_adjacency WHERE zone_id = ANY(%s) OR neighbor_id = ANY(%s)",
        (zone_ids, zone_ids),
    )
    cur.execute(
        """
        WITH borders AS (
          SELECT
            a.id AS zone_id,
            b.id AS neighbor_id,
            ST_Length(
              ST_CollectionExtract(
                ST_Intersection(ST_Boundary(a.geom), ST_Boundary(b.geom)),
                2
              )::geography
            ) AS shared_border_m,
            ST_Distance(a.centroid::geography, b.centroid::geography) / 1000.0
              AS centroid_distance_km,
            a.country_iso2 <> b.country_iso2 AS cross_border
          FROM zones a
          JOIN zones b ON a.id <> b.id
          WHERE a.id = ANY(%s)
            AND b.id = ANY(%s)
            AND ST_Touches(a.geom, b.geom)
        )
        INSERT INTO zone_adjacency (
          zone_id,
          neighbor_id,
          shared_border_m,
          centroid_distance_km,
          cross_border
        )
        SELECT
          zone_id,
          neighbor_id,
          shared_border_m,
          centroid_distance_km,
          cross_border
        FROM borders
        WHERE shared_border_m > 0
        ON CONFLICT (zone_id, neighbor_id) DO UPDATE
        SET shared_border_m = EXCLUDED.shared_border_m,
            centroid_distance_km = EXCLUDED.centroid_distance_km,
            cross_border = EXCLUDED.cross_border
        """,
        (zone_ids, zone_ids),
    )
    return cur.rowcount


def upsert_exposure(cur: psycopg.Cursor[Any], exposure: dict[str, Any]) -> None:
    for zone_id, values in exposure.items():
        cur.execute(
            """
            INSERT INTO zone_exposure (
              zone_id,
              population,
              pastoralist_share,
              water_points,
              markets,
              source,
              updated_at
            )
            VALUES (%s, %s, %s, %s, %s, 'seeded', %s)
            ON CONFLICT (zone_id) DO UPDATE
            SET population = EXCLUDED.population,
                pastoralist_share = EXCLUDED.pastoralist_share,
                water_points = EXCLUDED.water_points,
                markets = EXCLUDED.markets,
                source = EXCLUDED.source,
                updated_at = EXCLUDED.updated_at
            """,
            (
                zone_id,
                values["population"],
                values["pastoralist_share"],
                values["water_points"],
                values["markets"],
                SEEDED_EXPOSURE_UPDATED_AT,
            ),
        )


def upsert_acled_events(cur: psycopg.Cursor[Any], events: list[dict[str, Any]]) -> int:
    for event in events:
        cur.execute(
            """
            WITH point_value AS (
              SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom
            ),
            zone_match AS (
              SELECT z.id
              FROM zones z, point_value p
              WHERE ST_Contains(z.geom, p.geom)
              ORDER BY z.id
              LIMIT 1
            )
            INSERT INTO acled_events (
              event_id,
              event_date,
              zone_id,
              event_type,
              fatalities,
              actor1,
              actor2,
              notes,
              geom,
              available_at,
              source
            )
            SELECT
              %s,
              %s,
              (SELECT id FROM zone_match),
              %s,
              %s,
              %s,
              %s,
              %s,
              geom,
              %s,
              'acled'
            FROM point_value
            ON CONFLICT (event_id) DO UPDATE
            SET event_date = EXCLUDED.event_date,
                zone_id = EXCLUDED.zone_id,
                event_type = EXCLUDED.event_type,
                fatalities = EXCLUDED.fatalities,
                actor1 = EXCLUDED.actor1,
                actor2 = EXCLUDED.actor2,
                notes = EXCLUDED.notes,
                geom = EXCLUDED.geom,
                available_at = EXCLUDED.available_at,
                source = EXCLUDED.source
            """,
            (
                event["lon"],
                event["lat"],
                event["event_id"],
                event["event_date"],
                event["event_type"],
                event["fatalities"],
                event.get("actor1"),
                event.get("actor2"),
                event.get("notes"),
                event["available_at"],
            ),
        )

    event_ids = [event["event_id"] for event in events]
    cur.execute(
        "SELECT count(*) FROM acled_events WHERE event_id = ANY(%s) AND zone_id IS NULL",
        (event_ids,),
    )
    return int(cur.fetchone()[0])


def upsert_climate(cur: psycopg.Cursor[Any], climate_rows: list[dict[str, Any]]) -> None:
    for row in climate_rows:
        cur.execute(
            """
            INSERT INTO zone_climate_dekadal (
              zone_id,
              dekad_start,
              rain_mm,
              rain_available_at,
              ndvi_mean,
              ndvi_available_at
            )
            VALUES (%s, %s, %s, %s, %s, %s)
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
            """,
            (
                row["zone_id"],
                row["dekad_start"],
                row["rain_mm"],
                row["rain_available_at"],
                row["ndvi_mean"],
                row["ndvi_available_at"],
            ),
        )


def upsert_news_documents(cur: psycopg.Cursor[Any], articles: list[dict[str, Any]]) -> None:
    for article in articles:
        cur.execute(
            """
            INSERT INTO news_documents (
              external_id,
              title,
              body,
              source,
              published_at,
              available_at
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (external_id) DO UPDATE
            SET title = EXCLUDED.title,
                body = EXCLUDED.body,
                source = EXCLUDED.source,
                published_at = EXCLUDED.published_at,
                available_at = EXCLUDED.available_at
            """,
            (
                article["id"],
                article["title"],
                article["body"],
                article["source"],
                article["published_at"],
                article["available_at"],
            ),
        )


def recipient_id(phone_e164: str) -> uuid.UUID:
    return uuid.uuid5(RECIPIENT_NAMESPACE, f"dira:seeded:recipient:{phone_e164}")


def upsert_recipients(cur: psycopg.Cursor[Any], recipients: list[dict[str, Any]]) -> None:
    for recipient in recipients:
        cur.execute(
            """
            INSERT INTO recipients (id, name, phone_e164, zone_id, channel, language, active)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                phone_e164 = EXCLUDED.phone_e164,
                zone_id = EXCLUDED.zone_id,
                channel = EXCLUDED.channel,
                language = EXCLUDED.language,
                active = EXCLUDED.active
            """,
            (
                recipient_id(recipient["phone_e164"]),
                recipient["name"],
                recipient["phone_e164"],
                recipient["zone_id"],
                recipient["channel"],
                recipient["language"],
                recipient["active"],
            ),
        )


def main() -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("[bootstrap] DATABASE_URL is required.")
        return 2

    clusters = [load_json("mandera/geojson/cluster.json")]
    clusters.extend(load_json("igad/geojson/clusters.json"))
    zones_geojson = load_json("mandera/geojson/zones.geojson")
    zones_geojson["features"].extend(load_json("igad/geojson/zones.geojson")["features"])
    exposure = load_json("mandera/exposure/exposure.json")
    exposure.update(load_json("igad/exposure/exposure.json"))
    acled_events = load_json("mandera/acled/events.json")
    acled_events.extend(load_json("igad/acled/events.json"))
    climate_rows = load_json("mandera/climate/climate.json")
    climate_rows.extend(load_json("igad/climate/climate.json"))
    articles = load_json("news/corpus/articles.json")
    articles.extend(load_json("igad/news_articles.json"))
    recipients = load_json("mandera/recipients.json")
    recipients.extend(load_json("igad/recipients.json"))

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            upsert_clusters(cur, clusters)
            zone_ids = upsert_zones(cur, zones_geojson)
            adjacency_count = recompute_adjacency(cur, zone_ids)
            upsert_exposure(cur, exposure)
            null_event_count = upsert_acled_events(cur, acled_events)
            upsert_climate(cur, climate_rows)
            upsert_news_documents(cur, articles)
            upsert_recipients(cur, recipients)

    print("[bootstrap] Seeded Mandera + IGAD fixtures loaded.")
    print(f"[bootstrap] clusters={len(clusters)} zones={len(zones_geojson['features'])}")
    print(f"[bootstrap] adjacency_edges={adjacency_count} exposures={len(exposure)}")
    print(f"[bootstrap] acled_events={len(acled_events)} null_zone_events={null_event_count}")
    print(f"[bootstrap] climate_dekads={len(climate_rows)} news_documents={len(articles)}")
    print(f"[bootstrap] recipients={len(recipients)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
