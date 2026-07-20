"""Build the training dataset (zone × dekad) via the SHARED feature builder.

Uses ``dira_features.FeatureBuilder`` — the exact same code the pipeline uses at inference —
so there is no train/serve skew. The caller supplies the observations (from fixtures or DB);
this module does no I/O.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from dira_features import FeatureBuilder


def _cutoff(dekad: date) -> datetime:
    return datetime(dekad.year, dekad.month, dekad.day, tzinfo=UTC)


def build_dataset(
    *,
    climate: list[dict[str, Any]],
    events: list[dict[str, Any]],
    adjacency: list[tuple[str, str]],
    dekads: list[date],
    zone_ids: list[str],
    min_dekad_index: int = 6,
) -> list[dict[str, Any]]:
    """Return a list of rows: {zone_id, dekad, cutoff, features, occurred, incidents}.

    ``min_dekad_index`` skips the earliest dekads with insufficient lag history.
    """
    builder = FeatureBuilder(climate, events, adjacency, dekads)
    rows: list[dict[str, Any]] = []
    for i, dekad in enumerate(dekads):
        if i < min_dekad_index:
            continue
        cutoff = _cutoff(dekad)
        for zid in zone_ids:
            features = builder.row(zid, dekad, cutoff)
            occurred, incidents = builder.label(zid, dekad)
            rows.append(
                {
                    "zone_id": zid,
                    "dekad": dekad,
                    "cutoff": cutoff,
                    "features": features,
                    "occurred": occurred,
                    "incidents": incidents,
                }
            )
    return rows
