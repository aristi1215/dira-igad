"""Pre-render environmental layers as static PNG tiles per layer/cycle (ADR 8, E2).

One PNG per (cycle, layer) over the cluster bounding box. The frontend's primary map is the
GeoJSON choropleth; these tiles back the optional environmental layers. Kept dependency-light:
a tiny built-in PNG encoder (stdlib zlib) avoids pulling Pillow/GDAL PNG drivers.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import Any

import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_bounds

# Green -> yellow -> orange -> red ramp (normalized value 0..1).
_RAMP = np.array(
    [[46, 204, 113], [241, 196, 15], [230, 126, 34], [231, 76, 60]], dtype=np.float64
)


def _colorize(norm: np.ndarray, mask: np.ndarray) -> np.ndarray:
    idx = np.clip(norm * (len(_RAMP) - 1), 0, len(_RAMP) - 1)
    lo = np.floor(idx).astype(int)
    hi = np.ceil(idx).astype(int)
    frac = (idx - lo)[..., None]
    rgb = (_RAMP[lo] * (1 - frac) + _RAMP[hi] * frac).astype(np.uint8)
    alpha = np.where(mask, 200, 0).astype(np.uint8)
    return np.dstack([rgb, alpha])


def _write_png(path: Path, rgba: np.ndarray) -> None:
    height, width = rgba.shape[:2]
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0
        raw.extend(rgba[y].tobytes())

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def render_layer_tile(
    out_dir: Path,
    cycle: str,
    layer: str,
    zone_values: list[tuple[dict[str, Any], float | None]],
    bounds: tuple[float, float, float, float],
    size: int = 256,
) -> Path:
    """Rasterize per-zone values into a PNG choropleth tile. Returns the written path."""
    minx, miny, maxx, maxy = bounds
    transform = from_bounds(minx, miny, maxx, maxy, size, size)
    values = [v for _, v in zone_values if v is not None]
    vmin, vmax = (min(values), max(values)) if values else (0.0, 1.0)
    span = (vmax - vmin) or 1.0

    value_grid = np.zeros((size, size), dtype=np.float64)
    mask_grid = np.zeros((size, size), dtype=bool)
    for feature, value in zone_values:
        if value is None:
            continue
        shapes = [(feature["geometry"], 1)]
        z = rasterize(shapes, out_shape=(size, size), transform=transform, fill=0, dtype="uint8")
        sel = z.astype(bool)
        value_grid[sel] = (value - vmin) / span
        mask_grid |= sel

    rgba = _colorize(value_grid, mask_grid)
    rgba = np.flipud(rgba)  # PNG row 0 is top; raster row 0 is north
    dest = out_dir / cycle
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{layer}.png"
    _write_png(path, np.ascontiguousarray(rgba))
    return path
