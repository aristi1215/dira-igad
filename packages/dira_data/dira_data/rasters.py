"""Live CHIRPS dekadal rainfall from the public UCSB Climate Hazards Center archive.

Downloads africa_dekad GeoTIFFs (gzipped) over HTTPS — no AWS credentials or
private bucket required. Zone means are computed with rasterio + zone polygons
from PostGIS. NDVI is left null so first-write-wins keeps any seeded NDVI.
"""

from __future__ import annotations

import gzip
import logging
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("dira.data.rasters")

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CACHE = ROOT / "data" / "cache" / "chirps"
CHIRPS_DEKAD_URL = (
    "https://data.chc.ucsb.edu/products/CHIRPS-2.0/africa_dekad/tifs/"
    "chirps-v2.0.{year}.{month:02d}.{dekad}.tif.gz"
)
NODATA = -9999.0


def dekad_index(dekad_start: date) -> int:
    """CHIRPS africa_dekad numbering: 1 (days 1–10), 2 (11–20), 3 (21–end)."""
    if dekad_start.day == 1:
        return 1
    if dekad_start.day == 11:
        return 2
    if dekad_start.day == 21:
        return 3
    raise ValueError(f"Not a dekad start: {dekad_start.isoformat()}")


def chirps_dekad_url(dekad_start: date) -> str:
    return CHIRPS_DEKAD_URL.format(
        year=dekad_start.year,
        month=dekad_start.month,
        dekad=dekad_index(dekad_start),
    )


class ChirpsHttpAdapter:
    """Live HazardDataSource using public CHIRPS dekadal Africa rasters."""

    def __init__(
        self,
        zone_geoms_geojson: dict[str, dict[str, Any]] | None = None,
        cache_dir: str | Path | None = None,
    ) -> None:
        self.zone_geoms = zone_geoms_geojson or {}
        self.cache_dir = Path(cache_dir or os.environ.get("CHIRPS_CACHE_DIR", DEFAULT_CACHE))
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def bind_zone_geoms(self, zone_geoms_geojson: dict[str, dict[str, Any]]) -> None:
        self.zone_geoms = zone_geoms_geojson

    def fetch_dekadal(
        self, zone_ids: list[str], dekad_start: date
    ) -> dict[str, dict[str, Any]]:
        if not self.zone_geoms:
            logger.warning("ChirpsHttpAdapter has no zone geometries — returning empty.")
            return {}
        try:
            tif_path = self._ensure_raster(dekad_start)
        except Exception as exc:  # noqa: BLE001 — degrade independently
            logger.warning("CHIRPS download failed for %s: %s", dekad_start, exc)
            return {}
        try:
            means = self._zonal_means(tif_path, zone_ids)
        except Exception as exc:  # noqa: BLE001
            logger.warning("CHIRPS zonal mean failed for %s: %s", dekad_start, exc)
            return {}

        available_at = datetime.combine(
            dekad_start + timedelta(days=5), datetime.min.time(), tzinfo=UTC
        )
        out: dict[str, dict[str, Any]] = {}
        for zid in zone_ids:
            rain = means.get(zid)
            if rain is None:
                continue
            out[zid] = {
                "rain_mm": rain,
                "rain_available_at": available_at,
                "ndvi_mean": None,
                "ndvi_available_at": None,
            }
        return out

    def _ensure_raster(self, dekad_start: date) -> Path:
        name = f"chirps-v2.0.{dekad_start.year}.{dekad_start.month:02d}.{dekad_index(dekad_start)}.tif"
        dest = self.cache_dir / name
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        url = chirps_dekad_url(dekad_start)
        logger.info("Downloading CHIRPS dekadal raster %s", url)
        with httpx.Client(timeout=180.0, follow_redirects=True) as client:
            response = client.get(url)
            response.raise_for_status()
            payload = response.content
        if url.endswith(".gz"):
            payload = gzip.decompress(payload)
        dest.write_bytes(payload)
        return dest

    def _zonal_means(self, tif_path: Path, zone_ids: list[str]) -> dict[str, float]:
        import numpy as np
        import rasterio
        from rasterio.mask import mask
        from shapely.geometry import shape

        out: dict[str, float] = {}
        with rasterio.open(tif_path) as src:
            for zid in zone_ids:
                geom = self.zone_geoms.get(zid)
                if not geom:
                    continue
                try:
                    data, _ = mask(src, [shape(geom)], crop=True, filled=True, nodata=NODATA)
                except ValueError:
                    # Zone outside raster extent
                    continue
                band = data[0].astype("float64")
                valid = band[(band != NODATA) & np.isfinite(band)]
                if valid.size == 0:
                    continue
                out[zid] = float(round(float(valid.mean()), 2))
        return out


# Back-compat alias used by older call sites / docs.
ChirpsS3Adapter = ChirpsHttpAdapter
