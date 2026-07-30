"""Data adapters and PostGIS repositories."""

from __future__ import annotations

from dira_data.acled_ingest import upsert_acled_events
from dira_data.adapters import (
    AcledApiAdapter,
    ChirpsS3Adapter,
    SeededAcledAdapter,
    SeededRasterAdapter,
    get_conflict_source,
    get_hazard_source,
)
from dira_data.climate import CLIMATE_FIRST_WRITE_WINS_SQL, upsert_climate_first_write_wins
from dira_data.db import (
    connect,
    load_acled_events,
    load_adjacency,
    load_adjacency_by_zone,
    load_climate_rows,
    load_exposure,
    load_zone_geoms_geojson,
    load_zones,
)
from dira_data.db_url import resolve_database_url
from dira_data.rasters import ChirpsHttpAdapter, chirps_dekad_url
from dira_data.tiles import render_placeholder_tile

__all__ = [
    "CLIMATE_FIRST_WRITE_WINS_SQL",
    "AcledApiAdapter",
    "ChirpsHttpAdapter",
    "ChirpsS3Adapter",
    "SeededAcledAdapter",
    "SeededRasterAdapter",
    "chirps_dekad_url",
    "connect",
    "get_conflict_source",
    "get_hazard_source",
    "resolve_database_url",
    "load_acled_events",
    "load_adjacency",
    "load_adjacency_by_zone",
    "load_climate_rows",
    "load_exposure",
    "load_zone_geoms_geojson",
    "load_zones",
    "render_placeholder_tile",
    "upsert_acled_events",
    "upsert_climate_first_write_wins",
]
