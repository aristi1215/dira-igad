"""Live ingestion adapters (network). Not exercised by seeded tests, but structured so that
DATA_MODE=live works with configuration only (definition of done #4).

A live-source failure raises a clear error (invariant 6) — degradation is a seeded-mode
guarantee, not a licence to silently swallow live failures.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

import httpx


class AcledApiAdapter:
    """Paginated ACLED API reader. Maps rows into the ingestion shape used by E1."""

    BASE = "https://api.acleddata.com/acled/read"

    def __init__(self, email: str | None = None, key: str | None = None, iso: str = "404|231|706"):
        # Mandera tri-border ISO country codes: Kenya|Ethiopia|Somalia.
        self.email = email or os.environ.get("ACLED_EMAIL")
        self.key = key or os.environ.get("ACLED_PASSWORD")
        self.iso = iso

    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:
        if not self.email or not self.key:
            raise RuntimeError("ACLED credentials missing (set ACLED_EMAIL / ACLED_PASSWORD)")
        rows: list[dict[str, Any]] = []
        page = 1
        with httpx.Client(timeout=30) as client:
            while True:
                resp = client.get(
                    self.BASE,
                    params={
                        "email": self.email,
                        "key": self.key,
                        "iso": self.iso,
                        "page": page,
                        "limit": 500,
                    },
                )
                resp.raise_for_status()
                payload = resp.json()
                data = payload.get("data", [])
                if not data:
                    break
                for e in data:
                    rows.append(
                        {
                            "event_id": str(e["event_id_cnty"]),
                            "event_date": e["event_date"],
                            "zone_id": None,  # spatial join to zones happens in E1
                            "event_type": e.get("event_type", "Unknown"),
                            "sub_event_type": e.get("sub_event_type"),
                            "fatalities": int(e.get("fatalities", 0) or 0),
                            "actor1": e.get("actor1"),
                            "actor2": e.get("actor2"),
                            "notes": e.get("notes"),
                            "lon": float(e["longitude"]),
                            "lat": float(e["latitude"]),
                            "available_at": e.get("timestamp") or e["event_date"],
                        }
                    )
                page += 1
        return [r for r in rows if _to_dt(r["available_at"]) <= cutoff]


class LiveRasterClimateSource:
    """Compute dekadal zonal means from CHIRPS/NDVI GeoTIFFs synced under $RASTER_DIR.

    Layout: ``$RASTER_DIR/{rain,ndvi}/YYYY-MM-DD.tif`` (dekad start). Operators sync CHIRPS
    and MODIS/NDVI rasters there; full S3 auto-download is a documented TODO (DEVIATIONS §7).
    ``available_at`` uses the file mtime as the publication proxy.
    """

    def __init__(self, zones_geojson_features: list[dict[str, Any]], raster_dir: str | None = None):
        self.features = zones_geojson_features
        self.raster_dir = raster_dir or os.environ.get("RASTER_DIR", "")

    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:  # pragma: no cover - live only
        from pathlib import Path

        from dira_data.zonal import zonal_mean

        if not self.raster_dir:
            raise RuntimeError("RASTER_DIR not set; live climate ingestion needs synced rasters")
        base = Path(self.raster_dir)
        rows_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        for layer, col, at_col in (("rain", "rain_mm", "rain_available_at"),
                                   ("ndvi", "ndvi", "ndvi_available_at")):
            for tif in sorted((base / layer).glob("*.tif")):
                dekad = tif.stem
                avail = datetime.fromtimestamp(tif.stat().st_mtime, tz=UTC)
                if avail > cutoff:
                    continue
                means = zonal_mean(str(tif), self.features)
                for zid, val in means.items():
                    key = (zid, dekad)
                    row = rows_by_key.setdefault(key, {"zone_id": zid, "dekad_start": dekad})
                    row[col] = val
                    row[at_col] = avail.isoformat()
        return list(rows_by_key.values())


def _to_dt(value: str) -> datetime:
    from dateutil import parser as dtparse

    dt = dtparse.parse(str(value))
    if dt.tzinfo is None:

        dt = dt.replace(tzinfo=UTC)
    return dt
