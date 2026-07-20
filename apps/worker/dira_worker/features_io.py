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


def build_feature_builder(
    conn: psycopg.Connection, up_to: date | None = None
) -> tuple[FeatureBuilder, list[str]]:
    """Build the shared FeatureBuilder from the DB.

    The dekad calendar must be a CONTINUOUS index covering the cycle (``up_to``) even though
    the current dekad's climate is not yet published — otherwise the cycle would have no
    position and every lag would be NULL.
    """
    climate = climate_repo.read_all(conn)
    events = events_repo.read_all(conn)
    adjacency = geo.adjacency_pairs(conn)
    zids = geo.zone_ids(conn)
    dekads_present = sorted({r["dekad_start"] for r in climate})
    if dekads_present:
        first, last = dekads_present[0], dekads_present[-1]
        if isinstance(first, str):
            first, last = date.fromisoformat(first), date.fromisoformat(last)
        if up_to and up_to > last:
            last = up_to
        dekads = enumerate_dekads(first, last)
    else:
        dekads = enumerate_dekads(up_to, up_to) if up_to else []
    return FeatureBuilder(climate, events, adjacency, dekads), zids
