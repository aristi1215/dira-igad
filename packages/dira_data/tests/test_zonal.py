"""Unit test for the live E2 zonal-statistics path (rasterio/rasterstats), synthetic raster."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from dira_data.zonal import zonal_mean  # noqa: E402
from rasterio.transform import from_bounds  # noqa: E402


def _write_raster(path: Path, bounds: tuple[float, float, float, float], value: float) -> None:
    minx, miny, maxx, maxy = bounds
    size = 20
    data = np.full((size, size), value, dtype="float32")
    transform = from_bounds(minx, miny, maxx, maxy, size, size)
    with rasterio.open(
        path, "w", driver="GTiff", height=size, width=size, count=1,
        dtype="float32", crs="EPSG:4326", transform=transform,
    ) as dst:
        dst.write(data, 1)


def test_zonal_mean_matches_constant_raster(tmp_path: Path) -> None:
    # One square zone; a constant raster over it -> mean equals the constant.
    zone = {
        "type": "Feature",
        "properties": {"id": "z1"},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        },
    }
    tif = tmp_path / "layer.tif"
    _write_raster(tif, (-0.5, -0.5, 1.5, 1.5), 3.5)
    result = zonal_mean(str(tif), [zone])
    assert result["z1"] == pytest.approx(3.5, abs=1e-4)


def test_zone_without_coverage_is_none(tmp_path: Path) -> None:
    zone = {
        "type": "Feature",
        "properties": {"id": "far"},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[100, 100], [101, 100], [101, 101], [100, 101], [100, 100]]],
        },
    }
    tif = tmp_path / "layer.tif"
    _write_raster(tif, (-0.5, -0.5, 1.5, 1.5), 2.0)
    result = zonal_mean(str(tif), [zone])
    assert result["far"] is None
