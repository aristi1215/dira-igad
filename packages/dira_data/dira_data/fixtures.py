"""Locators and loaders for the committed seeded fixtures (data/seeded/mandera/)."""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import Any


def seeded_dir() -> Path:
    """Root of the Mandera seeded fixtures. Overridable via $DIRA_SEEDED_DIR (tests)."""
    override = os.environ.get("DIRA_SEEDED_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3] / "data" / "seeded" / "mandera"


def load_json(name: str) -> Any:
    return json.loads((seeded_dir() / name).read_text())


def load_csv(name: str) -> list[dict[str, str]]:
    with (seeded_dir() / name).open(newline="") as f:
        return list(csv.DictReader(f))
