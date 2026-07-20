"""Tiny placeholder tile rendering for scaffolded pipeline output."""

from __future__ import annotations

import struct
import zlib
from datetime import date
from pathlib import Path


def render_placeholder_tile(layer: str, cycle: date | str, out_dir: str | Path) -> Path:
    """Write a small deterministic PNG so pipeline runs have a tile artifact."""

    cycle_text = cycle.isoformat() if isinstance(cycle, date) else str(cycle)
    target_dir = Path(out_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{layer}_{cycle_text}.png"
    color_seed = zlib.crc32(f"{layer}:{cycle_text}".encode())
    rgb = ((color_seed >> 16) & 0xFF, (color_seed >> 8) & 0xFF, color_seed & 0xFF)
    path.write_bytes(_png_1x1(rgb))
    return path


def _png_1x1(rgb: tuple[int, int, int]) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        checksum = struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        return struct.pack(">I", len(payload)) + body + checksum

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw_scanline = b"\x00" + bytes(rgb)
    return (
        signature
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw_scanline))
        + chunk(b"IEND", b"")
    )
