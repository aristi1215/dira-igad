"""Data-source adapters for seeded and live modes."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

from dira_core.ports import ConflictEvent

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SEED_DIR = ROOT / "data" / "seeded"


class SeededAcledAdapter:
    """Read ACLED-like conflict events from seeded JSON fixtures."""

    def __init__(self, seed_dir: str | Path = DEFAULT_SEED_DIR) -> None:
        self.seed_dir = Path(seed_dir)

    def events(self, zone_ids: list[str], since: date) -> list[ConflictEvent]:
        wanted = set(zone_ids)
        rows = _read_json(_fixture_path(self.seed_dir, "mandera/acled/events.json", "events.json"))
        out: list[ConflictEvent] = []
        for row in rows:
            event_date = _parse_date(row["event_date"])
            if event_date < since:
                continue
            zone_id = row.get("zone_id")
            if zone_id is not None and wanted and zone_id not in wanted:
                continue
            out.append(
                ConflictEvent(
                    event_id=str(row["event_id"]),
                    event_date=event_date,
                    zone_id=zone_id,
                    event_type=str(row["event_type"]),
                    fatalities=int(row.get("fatalities", 0)),
                    notes=row.get("notes"),
                    actor1=row.get("actor1"),
                    actor2=row.get("actor2"),
                    lon=_optional_float(row.get("lon")),
                    lat=_optional_float(row.get("lat")),
                    available_at=_parse_datetime(row["available_at"])
                    if row.get("available_at")
                    else None,
                )
            )
        return out


class SeededRasterAdapter:
    """Read dekadal rain and NDVI values from seeded JSON fixtures."""

    def __init__(self, seed_dir: str | Path = DEFAULT_SEED_DIR) -> None:
        self.seed_dir = Path(seed_dir)

    def fetch_dekadal(self, zone_ids: list[str], dekad_start: date) -> dict[str, dict[str, Any]]:
        rows = _read_json(
            _fixture_path(self.seed_dir, "mandera/climate/climate.json", "climate.json")
        )
        wanted = set(zone_ids)
        out: dict[str, dict[str, Any]] = {}
        for row in rows:
            if row.get("zone_id") not in wanted:
                continue
            if _parse_date(row["dekad_start"]) != dekad_start:
                continue
            out[str(row["zone_id"])] = {
                "rain_mm": _optional_float(row.get("rain_mm")),
                "rain_available_at": _parse_datetime(row["rain_available_at"])
                if row.get("rain_available_at")
                else None,
                "ndvi_mean": _optional_float(row.get("ndvi_mean")),
                "ndvi_available_at": _parse_datetime(row["ndvi_available_at"])
                if row.get("ndvi_available_at")
                else None,
            }
        return out


class AcledApiAdapter:
    """Live ACLED adapter placeholder.

    The live API contract and key names are not fixed in the scaffold yet, so
    fail clearly instead of silently mixing seeded and live data.
    """

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("ACLED_API_KEY")
        if not self.api_key:
            raise RuntimeError("DATA_MODE=live requires ACLED_API_KEY for AcledApiAdapter.")

    def events(self, zone_ids: list[str], since: date) -> list[ConflictEvent]:
        raise RuntimeError(
            "Live ACLED fetching is not implemented in this scaffold; use DATA_MODE=seeded."
        )


class ChirpsS3Adapter:
    """Live CHIRPS/NDVI hazard adapter placeholder."""

    def __init__(self, bucket: str | None = None) -> None:
        self.bucket = bucket or os.environ.get("CHIRPS_S3_BUCKET")
        if not self.bucket:
            raise RuntimeError("DATA_MODE=live requires CHIRPS_S3_BUCKET for ChirpsS3Adapter.")

    def fetch_dekadal(self, zone_ids: list[str], dekad_start: date) -> dict[str, dict[str, Any]]:
        raise RuntimeError(
            "Live hazard raster fetching is not implemented in this scaffold; "
            "use DATA_MODE=seeded."
        )


def get_conflict_source(data_mode: str | None = None) -> SeededAcledAdapter | AcledApiAdapter:
    mode = (data_mode or os.environ.get("DATA_MODE", "seeded")).lower()
    if mode == "seeded":
        return SeededAcledAdapter(os.environ.get("SEEDED_DATA_DIR", DEFAULT_SEED_DIR))
    if mode == "live":
        return AcledApiAdapter()
    raise ValueError(f"Unsupported DATA_MODE for conflict source: {mode!r}")


def get_hazard_source(data_mode: str | None = None) -> SeededRasterAdapter | ChirpsS3Adapter:
    mode = (data_mode or os.environ.get("DATA_MODE", "seeded")).lower()
    if mode == "seeded":
        return SeededRasterAdapter(os.environ.get("SEEDED_DATA_DIR", DEFAULT_SEED_DIR))
    if mode == "live":
        return ChirpsS3Adapter()
    raise ValueError(f"Unsupported DATA_MODE for hazard source: {mode!r}")


def _fixture_path(seed_dir: Path, nested: str, flat: str) -> Path:
    nested_path = seed_dir / nested
    if nested_path.exists():
        return nested_path
    return seed_dir / flat


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)
