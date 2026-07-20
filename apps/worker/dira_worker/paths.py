"""Filesystem locations for pipeline outputs (static tiles, generated audio)."""

from __future__ import annotations

import os
from pathlib import Path


def _repo_root() -> Path:
    # apps/worker/dira_worker/paths.py -> repo root
    return Path(__file__).resolve().parents[3]


def tiles_dir() -> Path:
    """Static PNG tiles served by the API. Overridable via $DIRA_TILES_DIR (tests)."""
    override = os.environ.get("DIRA_TILES_DIR")
    base = Path(override) if override else _repo_root() / "apps" / "api" / "static" / "tiles"
    base.mkdir(parents=True, exist_ok=True)
    return base
