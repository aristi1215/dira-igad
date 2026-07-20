"""Select ingestion adapters by DATA_MODE. All data adapters swap together (ADR 2)."""

from __future__ import annotations

import os
from typing import Any

from dira_data.adapters import seeded
from dira_data.adapters.base import ClimateSource, EventSource, NewsSource


def data_mode() -> str:
    return os.environ.get("DATA_MODE", "seeded").lower()


def climate_source(zone_features: list[dict[str, Any]] | None = None) -> ClimateSource:
    if data_mode() == "live":
        from dira_data.adapters.live import LiveRasterClimateSource

        return LiveRasterClimateSource(zone_features or [])
    return seeded.SeededClimateSource()


def event_source() -> EventSource:
    if data_mode() == "live":
        from dira_data.adapters.live import AcledApiAdapter

        return AcledApiAdapter()
    return seeded.SeededEventSource()


def news_source() -> NewsSource:
    # Live news ingestion is out of the seeded demo scope; the seeded corpus is the demo path
    # (DEVIATIONS.md §7). In live mode a configured feed adapter would be injected here.
    return seeded.SeededNewsSource()
