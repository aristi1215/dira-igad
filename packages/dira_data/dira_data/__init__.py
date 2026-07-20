"""Data adapters and PostGIS repositories."""

from __future__ import annotations

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
    load_zones,
)
from dira_data.tiles import render_placeholder_tile

__all__ = [
    "CLIMATE_FIRST_WRITE_WINS_SQL",
    "AcledApiAdapter",
    "ChirpsS3Adapter",
    "SeededAcledAdapter",
    "SeededRasterAdapter",
    "connect",
    "get_conflict_source",
    "get_hazard_source",
    "load_acled_events",
    "load_adjacency",
    "load_adjacency_by_zone",
    "load_climate_rows",
    "load_exposure",
    "load_zones",
    "render_placeholder_tile",
    "upsert_climate_first_write_wins",
]
