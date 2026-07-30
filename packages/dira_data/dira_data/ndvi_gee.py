"""MODIS MOD13Q1 NDVI via Google Earth Engine (zone means).

Alignment rule (documented): for each dekadal cycle, take the newest
MOD13Q1 composite whose ``system:time_start`` is on or before the inclusive
dekad end, and not older than 32 days before the dekad start. Scale NDVI by
0.0001. Missing composites → null (first-write-wins keeps prior values).
"""

from __future__ import annotations

import logging
import os
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

from dira_core.time import dekad_end

logger = logging.getLogger("dira.data.ndvi_gee")

NDVI_SCALE = 0.0001
COLLECTION = "MODIS/061/MOD13Q1"

_ee_module: Any | None = None
_ee_project_inited: str | None = None
_ee_cooldown_until: float = 0.0
_ee_consecutive_failures: int = 0


def _ee_initialize(project: str | None = None) -> Any:
    global _ee_module, _ee_project_inited, _ee_cooldown_until, _ee_consecutive_failures
    import ee

    project = project or os.environ.get("EE_PROJECT") or os.environ.get("GOOGLE_PROJECT_ID")
    if not project:
        raise RuntimeError(
            "EE_PROJECT (or GOOGLE_PROJECT_ID) is required for GeeNdviAdapter. "
            "Use your Earth Engine Cloud project id, not a Maps AIza key."
        )
    if _ee_module is not None and _ee_project_inited == project:
        return _ee_module
    now = time.time()
    if now < _ee_cooldown_until:
        raise RuntimeError(
            f"Earth Engine in cooldown for {int(_ee_cooldown_until - now)}s "
            f"after {_ee_consecutive_failures} consecutive failures"
        )
    last_exc: Exception | None = None
    for attempt in range(1, 4):
        try:
            ee.Initialize(project=project)
            _ee_module = ee
            _ee_project_inited = project
            _ee_consecutive_failures = 0
            _ee_cooldown_until = 0.0
            return ee
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            sleep_s = min(2**attempt, 20)
            logger.warning(
                "Earth Engine init attempt %s/3 failed: %s — retry in %ss",
                attempt,
                exc,
                sleep_s,
            )
            time.sleep(sleep_s)
    _ee_consecutive_failures += 1
    # Back off hard so a rain-only pass can finish without 14s of sleep per dekad.
    _ee_cooldown_until = time.time() + min(60 * _ee_consecutive_failures, 300)
    assert last_exc is not None
    raise last_exc


class GeeNdviAdapter:
    """Live HazardDataSource fragment: NDVI only (rain stays with CHIRPS)."""

    def __init__(
        self,
        zone_geoms_geojson: dict[str, dict[str, Any]] | None = None,
        *,
        project: str | None = None,
    ) -> None:
        self.zone_geoms = zone_geoms_geojson or {}
        self.project = project

    def bind_zone_geoms(self, zone_geoms_geojson: dict[str, dict[str, Any]]) -> None:
        self.zone_geoms = zone_geoms_geojson

    def fetch_dekadal(
        self, zone_ids: list[str], dekad_start: date
    ) -> dict[str, dict[str, Any]]:
        if not self.zone_geoms:
            logger.warning("GeeNdviAdapter has no zone geometries — returning empty.")
            return {}
        try:
            ee = _ee_initialize(self.project)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Earth Engine init failed: %s", exc)
            return {}

        end = dekad_end(dekad_start)
        window_start = dekad_start - timedelta(days=32)
        rows: list[dict[str, Any]] = []
        last_exc: Exception | None = None
        for attempt in range(1, 4):
            try:
                collection = (
                    ee.ImageCollection(COLLECTION)
                    .filterDate(window_start.isoformat(), (end + timedelta(days=1)).isoformat())
                    .select("NDVI")
                    .sort("system:time_start", False)
                )
                # Guard empty collection
                count = collection.size().getInfo()
                if not count:
                    return {}
                image = ee.Image(collection.first())

                features = []
                for zid in zone_ids:
                    geom = self.zone_geoms.get(zid)
                    if not geom:
                        continue
                    features.append(
                        ee.Feature(ee.Geometry(geom), {"zone_id": zid})
                    )
                if not features:
                    return {}
                fc = ee.FeatureCollection(features)
                reduced = image.multiply(NDVI_SCALE).reduceRegions(
                    collection=fc,
                    reducer=ee.Reducer.mean(),
                    scale=250,
                )
                rows = reduced.getInfo().get("features") or []
                last_exc = None
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                sleep_s = min(2**attempt, 20)
                logger.warning(
                    "GEE NDVI fetch attempt %s/3 failed for %s: %s — retry in %ss",
                    attempt,
                    dekad_start,
                    exc,
                    sleep_s,
                )
                time.sleep(sleep_s)
        if last_exc is not None:
            logger.warning("GEE NDVI fetch failed for %s: %s", dekad_start, last_exc)
            return {}

        available_at = datetime.combine(end + timedelta(days=8), datetime.min.time(), tzinfo=UTC)
        out: dict[str, dict[str, Any]] = {}
        for feature in rows:
            props = feature.get("properties") or {}
            zid = props.get("zone_id")
            mean = props.get("mean")
            if zid is None or mean is None:
                continue
            try:
                value = float(mean)
            except (TypeError, ValueError):
                continue
            out[str(zid)] = {
                "rain_mm": None,
                "rain_available_at": None,
                "ndvi_mean": round(value, 4),
                "ndvi_available_at": available_at,
            }
        return out


class GeeChirpsAdapter:
    """Dekadal rainfall via Earth Engine CHIRPS daily sums (HTTP fallback path)."""

    def __init__(
        self,
        zone_geoms_geojson: dict[str, dict[str, Any]] | None = None,
        *,
        project: str | None = None,
    ) -> None:
        self.zone_geoms = zone_geoms_geojson or {}
        self.project = project

    def bind_zone_geoms(self, zone_geoms_geojson: dict[str, dict[str, Any]]) -> None:
        self.zone_geoms = zone_geoms_geojson

    def fetch_dekadal(
        self, zone_ids: list[str], dekad_start: date
    ) -> dict[str, dict[str, Any]]:
        if not self.zone_geoms:
            logger.warning("GeeChirpsAdapter has no zone geometries — returning empty.")
            return {}
        try:
            ee = _ee_initialize(self.project)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Earth Engine init failed (CHIRPS): %s", exc)
            return {}

        end = dekad_end(dekad_start)
        rows: list[dict[str, Any]] = []
        last_exc: Exception | None = None
        for attempt in range(1, 4):
            try:
                collection = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filterDate(
                    dekad_start.isoformat(),
                    (end + timedelta(days=1)).isoformat(),
                )
                count = collection.size().getInfo()
                if not count:
                    return {}
                image = collection.sum().select("precipitation")
                features = []
                for zid in zone_ids:
                    geom = self.zone_geoms.get(zid)
                    if not geom:
                        continue
                    features.append(ee.Feature(ee.Geometry(geom), {"zone_id": zid}))
                if not features:
                    return {}
                fc = ee.FeatureCollection(features)
                reduced = image.reduceRegions(
                    collection=fc,
                    reducer=ee.Reducer.mean(),
                    scale=5000,
                )
                rows = reduced.getInfo().get("features") or []
                last_exc = None
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                sleep_s = min(2**attempt, 20)
                logger.warning(
                    "GEE CHIRPS fetch attempt %s/3 failed for %s: %s — retry in %ss",
                    attempt,
                    dekad_start,
                    exc,
                    sleep_s,
                )
                time.sleep(sleep_s)
        if last_exc is not None:
            logger.warning("GEE CHIRPS fetch failed for %s: %s", dekad_start, last_exc)
            return {}

        available_at = datetime.combine(
            dekad_start + timedelta(days=5), datetime.min.time(), tzinfo=UTC
        )
        out: dict[str, dict[str, Any]] = {}
        for feature in rows:
            props = feature.get("properties") or {}
            zid = props.get("zone_id")
            mean = props.get("mean")
            if zid is None or mean is None:
                continue
            try:
                value = float(mean)
            except (TypeError, ValueError):
                continue
            out[str(zid)] = {
                "rain_mm": round(value, 2),
                "rain_available_at": available_at,
                "ndvi_mean": None,
                "ndvi_available_at": None,
            }
        return out


class FallbackRainAdapter:
    """Prefer HTTP CHIRPS (cache-friendly); fall back to GEE when empty."""

    def __init__(self, primary: Any, secondary: Any) -> None:
        self.primary = primary
        self.secondary = secondary

    def bind_zone_geoms(self, zone_geoms_geojson: dict[str, dict[str, Any]]) -> None:
        if hasattr(self.primary, "bind_zone_geoms"):
            self.primary.bind_zone_geoms(zone_geoms_geojson)
        if hasattr(self.secondary, "bind_zone_geoms"):
            self.secondary.bind_zone_geoms(zone_geoms_geojson)

    def fetch_dekadal(
        self, zone_ids: list[str], dekad_start: date
    ) -> dict[str, dict[str, Any]]:
        primary = self.primary.fetch_dekadal(zone_ids, dekad_start) or {}
        if primary and any(row.get("rain_mm") is not None for row in primary.values()):
            return primary
        return self.secondary.fetch_dekadal(zone_ids, dekad_start) or {}


class CombinedClimateAdapter:
    """Merge CHIRPS rainfall with GEE NDVI for live HazardDataSource."""

    def __init__(self, rain: Any, ndvi: Any) -> None:
        self.rain = rain
        self.ndvi = ndvi

    def bind_zone_geoms(self, zone_geoms_geojson: dict[str, dict[str, Any]]) -> None:
        if hasattr(self.rain, "bind_zone_geoms"):
            self.rain.bind_zone_geoms(zone_geoms_geojson)
        if hasattr(self.ndvi, "bind_zone_geoms"):
            self.ndvi.bind_zone_geoms(zone_geoms_geojson)

    def fetch_dekadal(
        self, zone_ids: list[str], dekad_start: date
    ) -> dict[str, dict[str, Any]]:
        rain_rows = self.rain.fetch_dekadal(zone_ids, dekad_start) or {}
        ndvi_rows = self.ndvi.fetch_dekadal(zone_ids, dekad_start) or {}
        out: dict[str, dict[str, Any]] = {}
        for zid in zone_ids:
            r = rain_rows.get(zid) or {}
            n = ndvi_rows.get(zid) or {}
            if not r and not n:
                continue
            out[zid] = {
                "rain_mm": r.get("rain_mm"),
                "rain_available_at": r.get("rain_available_at"),
                "ndvi_mean": n.get("ndvi_mean"),
                "ndvi_available_at": n.get("ndvi_available_at"),
            }
        return out
