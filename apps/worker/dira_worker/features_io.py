"""Assemble the shared FeatureBuilder from the database (inference/E4 path).

Reads ALL observations (the builder itself applies the bitemporal cut per cutoff), so this is
the exact mirror of the training path — the only difference is the data source, guaranteeing
no train/serve skew.
"""

from __future__ import annotations

from datetime import date

import psycopg
from dira_data.repositories import climate as climate_repo
from dira_data.repositories import events as events_repo
from dira_data.repositories import geo
from dira_features import FeatureBuilder, enumerate_dekads


def build_feature_builder(conn: psycopg.Connection) -> tuple[FeatureBuilder, list[str]]:
    climate = climate_repo.read_all(conn)
    events = events_repo.read_all(conn)
    adjacency = geo.adjacency_pairs(conn)
    zids = geo.zone_ids(conn)
    dekads_present = sorted({r["dekad_start"] for r in climate})
    if dekads_present:
        first, last = dekads_present[0], dekads_present[-1]
        if isinstance(first, str):
            first, last = date.fromisoformat(first), date.fromisoformat(last)
        dekads = enumerate_dekads(first, last)
    else:
        dekads = []
    return FeatureBuilder(climate, events, adjacency, dekads), zids
