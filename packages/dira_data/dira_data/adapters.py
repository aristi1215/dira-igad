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
        rows = _read_json_multi(
            self.seed_dir,
            ("mandera/acled/events.json", "igad/acled/events.json", "events.json"),
        )
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
        rows = _read_json_multi(
            self.seed_dir,
            ("mandera/climate/climate.json", "igad/climate/climate.json", "climate.json"),
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
    """Live ACLED adapter using the OAuth password grant + /api/acled/read.

    Zone attribution happens downstream (PostGIS point-in-polygon at ingest),
    so events are returned with zone_id=None and lon/lat set.
    """

    TOKEN_URL = "https://acleddata.com/oauth/token"
    READ_URL = "https://acleddata.com/api/acled/read"
    COUNTRIES = (
        "Kenya|Ethiopia|Somalia|South Sudan|Sudan|Uganda|Djibouti|Eritrea"
    )
    PAGE_SIZE = 5000

    def __init__(self, email: str | None = None, password: str | None = None) -> None:
        self.email = email or os.environ.get("ACLED_EMAIL")
        self.password = password or os.environ.get("ACLED_PASSWORD")
        if not self.email or not self.password:
            raise RuntimeError(
                "DATA_MODE=live requires ACLED_EMAIL and ACLED_PASSWORD for AcledApiAdapter."
            )
        self._token: str | None = None

    def _access_token(self) -> str:
        if self._token:
            return self._token
        import httpx

        response = httpx.post(
            self.TOKEN_URL,
            data={
                "username": self.email,
                "password": self.password,
                "grant_type": "password",
                "client_id": "acled",
                "scope": "authenticated",
            },
            timeout=30,
        )
        response.raise_for_status()
        self._token = str(response.json()["access_token"])
        return self._token

    def events(self, zone_ids: list[str], since: date) -> list[ConflictEvent]:
        import httpx

        headers = {"Authorization": f"Bearer {self._access_token()}"}
        out: list[ConflictEvent] = []
        page = 1
        while True:
            response = httpx.get(
                self.READ_URL,
                params={
                    "country": self.COUNTRIES,
                    "event_date": since.isoformat(),
                    "event_date_where": ">=",
                    "limit": self.PAGE_SIZE,
                    "page": page,
                },
                headers=headers,
                timeout=120,
            )
            response.raise_for_status()
            payload = response.json()
            rows = payload.get("data", [])
            for row in rows:
                out.append(
                    ConflictEvent(
                        event_id=str(row["event_id_cnty"]),
                        event_date=_parse_date(row["event_date"]),
                        zone_id=None,
                        event_type=str(row.get("event_type", "unknown")),
                        fatalities=int(row.get("fatalities") or 0),
                        notes=row.get("notes"),
                        actor1=row.get("actor1"),
                        actor2=row.get("actor2"),
                        lon=_optional_float(row.get("longitude")),
                        lat=_optional_float(row.get("latitude")),
                        available_at=None,
                    )
                )
            if len(rows) < self.PAGE_SIZE:
                break
            page += 1
        return out


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


def _read_json_multi(seed_dir: Path, candidates: tuple[str, ...]) -> list[Any]:
    """Concatenate every fixture list that exists among the candidate paths."""
    rows: list[Any] = []
    found = False
    for rel in candidates:
        path = seed_dir / rel
        if path.exists():
            rows.extend(_read_json(path))
            found = True
    if not found:
        raise FileNotFoundError(f"No seeded fixture found among {candidates} in {seed_dir}")
    return rows


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
