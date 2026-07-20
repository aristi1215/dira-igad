"""Zonal statistics with rasterstats (live E2). Seeded mode reads precomputed values instead
(DEVIATIONS.md §4), but this is the real code path for CHIRPS/NDVI rasters and is unit-tested
against a small synthetic raster."""

from __future__ import annotations

from typing import Any

try:  # optional: only present when the `rasters` extra is installed
    from rasterstats import zonal_stats as _zonal_stats
except Exception:  # pragma: no cover - exercised only when extra is missing
    _zonal_stats = None


def _bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []

    def walk(coords: Any) -> None:
        if isinstance(coords, (int, float)):
            return
        if coords and isinstance(coords[0], (int, float)):
            xs.append(coords[0])
            ys.append(coords[1])
            return
        for c in coords:
            walk(c)

    walk(geometry["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)


def _intersects(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def zonal_mean(
    raster_path: str, zone_geojson_features: list[dict[str, Any]]
) -> dict[str, float | None]:
    """Return {zone_id: mean value} for each zone polygon over ``raster_path``.

    A zone that does not intersect the raster extent yields None — the pipeline continues with
    NULL columns rather than aborting (edge case: missing/partial raster).
    """
    if _zonal_stats is None:  # pragma: no cover
        raise RuntimeError("rasterstats not installed; install the `rasters` extra for live mode")
    import rasterio

    with rasterio.open(raster_path) as src:
        r_bounds = (src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top)

    out: dict[str, float | None] = {}
    covered = []
    for f in zone_geojson_features:
        zid = f["properties"]["id"]
        if _intersects(_bbox(f["geometry"]), r_bounds):
            covered.append(f)
        else:
            out[zid] = None

    if covered:
        stats = _zonal_stats(
            [f["geometry"] for f in covered], raster_path,
            stats=["mean", "count"], all_touched=True, nodata=None,
        )
        for feature, stat in zip(covered, stats, strict=True):
            mean = stat.get("mean") if stat else None
            count = stat.get("count") if stat else 0
            out[feature["properties"]["id"]] = float(mean) if (mean is not None and count) else None
    return out
