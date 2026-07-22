"""Country economy indicators for the IGAD region.

Seeded adapter reads a committed snapshot; live adapter refreshes selected
World Bank WDI series (open API, no key) and falls back to the snapshot when
the API is unavailable — demo insurance, same as every other data edge.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SEED_PATH = ROOT / "data" / "seeded" / "economy" / "indicators.json"

logger = logging.getLogger("dira.data.economy")

WORLD_BANK_ISO3 = {
    "KE": "KEN",
    "ET": "ETH",
    "SO": "SOM",
    "SS": "SSD",
    "SD": "SDN",
    "UG": "UGA",
    "DJ": "DJI",
    "ER": "ERI",
}

WB_SERIES = {
    "gdp_usd_bn": ("NY.GDP.MKTP.CD", 1e-9),
    "gdp_growth_pct": ("NY.GDP.MKTP.KD.ZG", 1.0),
    "inflation_pct": ("FP.CPI.TOTL.ZG", 1.0),
    "population_m": ("SP.POP.TOTL", 1e-6),
}


class SeededEconomyAdapter:
    def __init__(self, seed_path: str | Path | None = None) -> None:
        self.seed_path = Path(
            seed_path or os.environ.get("SEEDED_ECONOMY_PATH", DEFAULT_SEED_PATH)
        )

    def indicators(self) -> dict[str, Any]:
        return json.loads(self.seed_path.read_text(encoding="utf-8"))


class WorldBankEconomyAdapter:
    """Refresh numeric series from the World Bank API on top of the snapshot."""

    BASE = "https://api.worldbank.org/v2"

    def __init__(self, seed_path: str | Path | None = None) -> None:
        self.seeded = SeededEconomyAdapter(seed_path)

    def indicators(self) -> dict[str, Any]:
        snapshot = self.seeded.indicators()
        try:
            refreshed = self._fetch(snapshot["years"])
        except Exception:
            logger.exception("World Bank API unavailable; serving seeded snapshot")
            snapshot["source"] += " [live refresh failed]"
            return snapshot
        for iso2, series in refreshed.items():
            country = snapshot["countries"].get(iso2)
            if country:
                country.update({k: v for k, v in series.items() if any(x is not None for x in v)})
        snapshot["source"] = "World Bank WDI (live refresh) over seeded snapshot"
        return snapshot

    def _fetch(self, years: list[int]) -> dict[str, dict[str, list[float | None]]]:
        import httpx

        date_range = f"{years[0]}:{years[-1]}"
        out: dict[str, dict[str, list[float | None]]] = {
            iso2: {} for iso2 in WORLD_BANK_ISO3
        }
        iso3_join = ";".join(WORLD_BANK_ISO3.values())
        iso3_to_iso2 = {v: k for k, v in WORLD_BANK_ISO3.items()}
        with httpx.Client(timeout=30) as client:
            for field, (code, scale) in WB_SERIES.items():
                url = f"{self.BASE}/country/{iso3_join}/indicator/{code}"
                response = client.get(
                    url, params={"format": "json", "date": date_range, "per_page": 400}
                )
                response.raise_for_status()
                payload = response.json()
                rows = payload[1] if len(payload) > 1 and payload[1] else []
                by_country: dict[str, dict[int, float]] = {}
                for row in rows:
                    iso3 = row.get("countryiso3code")
                    iso2 = iso3_to_iso2.get(iso3 or "")
                    value = row.get("value")
                    if iso2 is None or value is None:
                        continue
                    by_country.setdefault(iso2, {})[int(row["date"])] = float(value) * scale
                for iso2, per_year in by_country.items():
                    out[iso2][field] = [
                        round(per_year[y], 2) if y in per_year else None for y in years
                    ]
        return out


def get_economy_source(
    data_mode: str | None = None,
) -> SeededEconomyAdapter | WorldBankEconomyAdapter:
    mode = (data_mode or os.environ.get("DATA_MODE", "seeded")).lower()
    if mode == "live":
        return WorldBankEconomyAdapter()
    return SeededEconomyAdapter()
