"""Seeded ingestion adapters — read committed fixtures from disk.

Nothing external can fail here (invariant 6). ``available_at`` comes from the fixtures (real
publication dates), never ``now()``, so the bitemporal cut is identical in training/inference.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from dateutil import parser as dtparse

from dira_data import fixtures


def _dt(value: str) -> datetime:
    return dtparse.isoparse(value)


class SeededClimateSource:
    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for r in fixtures.load_csv("climate_dekadal.csv"):
            rain_at = _dt(r["rain_available_at"])
            ndvi_at = _dt(r["ndvi_available_at"])
            rain_visible = rain_at <= cutoff
            ndvi_visible = ndvi_at <= cutoff
            if not rain_visible and not ndvi_visible:
                continue  # nothing about this (zone, dekad) is knowable yet
            rows.append(
                {
                    "zone_id": r["zone_id"],
                    "dekad_start": r["dekad_start"],
                    # Mask each group to NULL until its available_at is reached (first-write-wins
                    # then fills it in a later cycle).
                    "rain_mm": float(r["rain_mm"]) if rain_visible else None,
                    "rain_anomaly": float(r["rain_anomaly"]) if rain_visible else None,
                    "rain_available_at": r["rain_available_at"] if rain_visible else None,
                    "ndvi": float(r["ndvi"]) if ndvi_visible else None,
                    "ndvi_anomaly": float(r["ndvi_anomaly"]) if ndvi_visible else None,
                    "ndvi_available_at": r["ndvi_available_at"] if ndvi_visible else None,
                }
            )
        return rows


class SeededEventSource:
    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for r in fixtures.load_csv("acled.csv"):
            if _dt(r["available_at"]) > cutoff:
                continue
            rows.append(
                {
                    "event_id": r["event_id"],
                    "event_date": r["event_date"],
                    "zone_id": r["zone_id"] or None,
                    "event_type": r["event_type"],
                    "sub_event_type": r["sub_event_type"] or None,
                    "fatalities": int(r["fatalities"]),
                    "actor1": r["actor1"],
                    "actor2": r["actor2"],
                    "notes": r["notes"],
                    "lon": float(r["lon"]),
                    "lat": float(r["lat"]),
                    "available_at": r["available_at"],
                }
            )
        return rows


class SeededNewsSource:
    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:
        docs = []
        for d in fixtures.load_json("news.json"):
            if _dt(d["available_at"]) > cutoff:
                continue
            docs.append(d)
        return docs
