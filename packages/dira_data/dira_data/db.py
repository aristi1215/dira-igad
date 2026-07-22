"""Small Postgres helpers used by ingestion, training, and feature building."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row


def connect(database_url: str | None = None) -> Connection[Any]:
    """Connect to Dira's Postgres database using psycopg3."""

    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required to connect to Dira Postgres.")
    return psycopg.connect(url, row_factory=dict_row)


def load_zones(conn: Connection[Any]) -> list[dict[str, Any]]:
    return _fetch_all(
        conn,
        """
        SELECT id, cluster_id, name, country_iso2, created_at
        FROM zones
        ORDER BY id
        """,
    )


def load_adjacency(conn: Connection[Any]) -> list[dict[str, Any]]:
    return _fetch_all(
        conn,
        """
        SELECT zone_id, neighbor_id, shared_border_m, centroid_distance_km, cross_border
        FROM zone_adjacency
        ORDER BY zone_id, neighbor_id
        """,
    )


def load_adjacency_by_zone(conn: Connection[Any]) -> dict[str, list[str]]:
    neighbors: dict[str, list[str]] = {}
    for row in load_adjacency(conn):
        neighbors.setdefault(str(row["zone_id"]), []).append(str(row["neighbor_id"]))
    return neighbors


def load_climate_rows(conn: Connection[Any]) -> list[dict[str, Any]]:
    return _fetch_all(
        conn,
        """
        SELECT zone_id, dekad_start, rain_mm, rain_available_at, ndvi_mean, ndvi_available_at
        FROM zone_climate_dekadal
        ORDER BY zone_id, dekad_start
        """,
    )


def load_acled_events(conn: Connection[Any]) -> list[dict[str, Any]]:
    return _fetch_all(
        conn,
        """
        SELECT
          event_id, event_date, zone_id, event_type, fatalities,
          actor1, actor2, notes, available_at, source
        FROM acled_events
        ORDER BY event_date, event_id
        """,
    )


def load_exposure(conn: Connection[Any]) -> dict[str, dict[str, Any]]:
    rows = _fetch_all(
        conn,
        """
        SELECT
          zone_id, population, pastoralist_share, water_points,
          markets, source, updated_at
        FROM zone_exposure
        ORDER BY zone_id
        """,
    )
    return {str(row.pop("zone_id")): row for row in rows}


def _fetch_all(conn: Connection[Any], sql: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql)
        return [dict(_as_mapping(row)) for row in cur.fetchall()]


def _as_mapping(row: object) -> Mapping[str, Any]:
    if isinstance(row, Mapping):
        return row
    raise TypeError("Dira DB helpers require a dict row factory.")
