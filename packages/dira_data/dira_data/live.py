"""Live connectors for the information layer (DATA_MODE=live only).

Design contract shared with every other data edge in Dira: the live call is a
*refresh on top of* the seeded baseline, and any failure — missing key, HTTP
error, schema drift — degrades to the seeded snapshot with a log line, never
an exception. The demo always runs seeded; live is verified separately.

Zone attribution: our synthetic demo zones are not real admin units, so live
sub-national rows only land on zones that declare a real-world admin mapping in
`data/seeded/igad/zone_admin_map.json`. Zones without a mapping keep their
seeded values — we never smear country-level numbers across zones.

Connectors:
  - HDX HAPI (hapi.humdata.org, free app identifier): IPC food security,
    IOM DTM IDPs, WFP food prices.
  - UNHCR population API (key-free): refugees hosted per country.
  - ReliefWeb API (registered appname): reports into news_documents, where the
    existing E3 LLM extraction turns them into zone signals.
  - FAO locust / GloFAS flood: no key-free JSON API — port documented here,
    seeded bulletins remain the operative source (stated in /sources).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("dira.data.live")

ROOT = Path(__file__).resolve().parents[3]
ZONE_ADMIN_MAP_PATH = ROOT / "data" / "seeded" / "igad" / "zone_admin_map.json"

ISO2_TO_ISO3 = {
    "KE": "KEN", "ET": "ETH", "SO": "SOM", "SS": "SSD",
    "SD": "SDN", "UG": "UGA", "DJ": "DJI", "ER": "ERI",
}
ISO3_TO_ISO2 = {v: k for k, v in ISO2_TO_ISO3.items()}


def load_zone_admin_map(path: Path | None = None) -> dict[str, dict[str, Any]]:
    p = path or ZONE_ADMIN_MAP_PATH
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class HdxHapiAdapter:
    """HDX Humanitarian API — one connector, three CEWARN indicator families.

    Requires HDX_APP_IDENTIFIER (base64 "app:email", free self-service:
    https://hapi.humdata.org/docs#/Generate%20App%20Identifier).
    """

    BASE = "https://hapi.humdata.org/api/v2"

    def __init__(self, app_identifier: str | None = None) -> None:
        self.app_identifier = app_identifier or os.environ.get("HDX_APP_IDENTIFIER", "")

    def available(self) -> bool:
        return bool(self.app_identifier)

    def _get(self, paths: list[str], params: dict[str, Any]) -> list[dict[str, Any]]:
        import httpx

        merged = {
            "output_format": "json",
            "limit": 1000,
            "app_identifier": self.app_identifier,
            **params,
        }
        last_error: Exception | None = None
        with httpx.Client(timeout=40) as client:
            for path in paths:
                try:
                    resp = client.get(f"{self.BASE}/{path}", params=merged)
                    resp.raise_for_status()
                    payload = resp.json()
                    return list(payload.get("data", []))
                except Exception as exc:  # noqa: BLE001 — try next candidate path
                    last_error = exc
        raise RuntimeError(f"HAPI request failed for {paths}: {last_error}")

    def food_security_rows(
        self, zone_admin_map: dict[str, dict[str, Any]]
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for zone_id, admin in zone_admin_map.items():
            data = self._get(
                ["food-security/food-security",
                 "food-security-nutrition-poverty/food-security"],
                {
                    "location_code": admin["iso3"],
                    "admin1_name": admin.get("admin1_name", ""),
                },
            )
            # HAPI reports one row per (period, ipc_phase); reduce to the zone
            # row shape: overall phase + population in phase 3+.
            by_period: dict[str, dict[str, Any]] = {}
            for r in data:
                period = str(r.get("reference_period_start", ""))[:10]
                if not period:
                    continue
                slot = by_period.setdefault(
                    period,
                    {"period_end": str(r.get("reference_period_end", ""))[:10] or period,
                     "phase": 1, "pop3plus": None},
                )
                phase_raw = str(r.get("ipc_phase", ""))
                pop = r.get("population_in_phase")
                if phase_raw == "3+":
                    slot["pop3plus"] = int(pop) if pop is not None else slot["pop3plus"]
                elif phase_raw.isdigit():
                    fraction = float(r.get("population_fraction_in_phase") or 0)
                    if int(phase_raw) > slot["phase"] and fraction >= 0.2:
                        slot["phase"] = int(phase_raw)
            for period, slot in by_period.items():
                rows.append({
                    "zone_id": zone_id,
                    "period_start": period,
                    "period_end": slot["period_end"],
                    "ipc_phase": max(1, min(5, int(slot["phase"]))),
                    "pop_phase3_plus": slot["pop3plus"],
                    "source": "hdx_hapi_ipc_live",
                    "available_at": _now_iso(),
                })
        return rows

    def idp_rows(self, zone_admin_map: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for zone_id, admin in zone_admin_map.items():
            data = self._get(
                ["affected-people/idps"],
                {
                    "location_code": admin["iso3"],
                    "admin1_name": admin.get("admin1_name", ""),
                },
            )
            for r in data:
                snapshot = str(r.get("reference_period_start", ""))[:10]
                population = r.get("population")
                if not snapshot or population is None:
                    continue
                rows.append({
                    "zone_id": zone_id,
                    "snapshot_date": snapshot,
                    "idps": int(population),
                    "refugees": 0,
                    "returnees": 0,
                    "source": "hdx_hapi_dtm_live",
                    "available_at": _now_iso(),
                })
        return rows

    def food_price_rows(
        self, zone_admin_map: dict[str, dict[str, Any]]
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        wanted = {"maize", "sorghum", "goat", "goats"}
        for zone_id, admin in zone_admin_map.items():
            data = self._get(
                ["food-prices/food-price", "food/food-price"],
                {
                    "location_code": admin["iso3"],
                    "admin1_name": admin.get("admin1_name", ""),
                },
            )
            for r in data:
                commodity = str(r.get("commodity_name", "")).lower()
                match = next((w for w in wanted if w in commodity), None)
                price = r.get("price")
                month = str(r.get("reference_period_start", ""))[:10]
                if match is None or price is None or not month:
                    continue
                rows.append({
                    "zone_id": zone_id,
                    "market_name": str(r.get("market_name") or "Unknown market"),
                    "month": f"{month[:7]}-01",
                    "commodity": "goat" if match.startswith("goat") else match,
                    "unit": str(r.get("unit") or "kg"),
                    "price": float(price),
                    "currency": str(r.get("currency_code") or "USD"),
                    "pct_vs_3m_avg": None,
                    "source": "hdx_hapi_wfp_live",
                    "available_at": _now_iso(),
                })
        return rows


class UnhcrRefugeeAdapter:
    """UNHCR population statistics — key-free, country-of-asylum totals."""

    BASE = "https://api.unhcr.org/population/v1/population/"

    def country_refugees(self, year: int | None = None) -> dict[str, dict[str, Any]]:
        import httpx

        target_year = year or datetime.now(UTC).year - 1
        out: dict[str, dict[str, Any]] = {}
        with httpx.Client(timeout=30) as client:
            for iso2, iso3 in ISO2_TO_ISO3.items():
                resp = client.get(
                    self.BASE, params={"coa": iso3, "year": target_year, "limit": 20}
                )
                resp.raise_for_status()
                items = resp.json().get("items", [])
                refugees = sum(int(i.get("refugees") or 0) for i in items)
                asylum = sum(int(i.get("asylum_seekers") or 0) for i in items)
                if refugees or asylum:
                    out[iso2] = {
                        "refugees_hosted": refugees,
                        "asylum_seekers": asylum,
                        "year": target_year,
                    }
        return out


class ReliefWebNewsAdapter:
    """ReliefWeb reports → news_documents rows (E3 extraction does the rest).

    Requires a registered appname (RELIEFWEB_APPNAME): apidoc.reliefweb.int.
    """

    BASE = "https://api.reliefweb.int/v2/reports"
    IGAD_COUNTRIES = [
        "Kenya", "Ethiopia", "Somalia", "South Sudan",
        "Sudan", "Uganda", "Djibouti", "Eritrea",
    ]

    def __init__(self, appname: str | None = None) -> None:
        self.appname = appname or os.environ.get("RELIEFWEB_APPNAME", "")

    def available(self) -> bool:
        return bool(self.appname)

    def fetch_articles(self, query: str, limit: int = 25) -> list[dict[str, Any]]:
        import httpx

        body = {
            "limit": limit,
            "query": {"value": query},
            "filter": {
                "field": "primary_country.name",
                "value": self.IGAD_COUNTRIES,
                "operator": "OR",
            },
            "sort": ["date.created:desc"],
            "fields": {"include": ["title", "body", "date.created", "source.name", "url"]},
        }
        with httpx.Client(timeout=40) as client:
            resp = client.post(f"{self.BASE}?appname={self.appname}", json=body)
            resp.raise_for_status()
            items = resp.json().get("data", [])
        articles = []
        for item in items:
            fields = item.get("fields", {})
            body_text = fields.get("body") or fields.get("title")
            if not body_text:
                continue
            created = str(fields.get("date", {}).get("created") or _now_iso())
            sources = fields.get("source") or []
            articles.append({
                "id": f"reliefweb-{item.get('id')}",
                "title": fields.get("title") or "(untitled)",
                "body": body_text[:8000],
                "source": (sources[0].get("name") if sources else "ReliefWeb"),
                "published_at": created,
                "available_at": _now_iso(),
            })
        return articles


def refresh_information_layer_live(cur: Any) -> dict[str, int]:
    """Overlay live rows on top of the seeded baseline. Per-connector
    degradation: one failing source never blocks the others."""
    from dira_data.context import (
        upsert_displacement,
        upsert_food_security,
        upsert_market_prices,
    )

    counts = {"food_security": 0, "displacement": 0, "market_prices": 0, "news": 0}
    zone_map = load_zone_admin_map()
    if not zone_map:
        logger.info("No zone_admin_map.json entries — live overlay skipped")
        return counts

    hapi = HdxHapiAdapter()
    if hapi.available():
        for kind, fetch, upsert in (
            ("food_security", hapi.food_security_rows, upsert_food_security),
            ("displacement", hapi.idp_rows, upsert_displacement),
            ("market_prices", hapi.food_price_rows, upsert_market_prices),
        ):
            try:
                rows = fetch(zone_map)
                upsert(cur, rows)
                counts[kind] = len(rows)
            except Exception as exc:  # noqa: BLE001
                logger.warning("HAPI %s refresh degraded: %s", kind, exc)
    else:
        logger.info("HDX_APP_IDENTIFIER unset — HAPI overlay skipped")

    reliefweb = ReliefWebNewsAdapter()
    if reliefweb.available():
        try:
            articles = reliefweb.fetch_articles(
                "drought OR displacement OR pastoralist conflict OR flood"
            )
            for a in articles:
                cur.execute(
                    """
                    INSERT INTO news_documents (
                      external_id, title, body, source, published_at, available_at
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (external_id) DO NOTHING
                    """,
                    (a["id"], a["title"], a["body"], a["source"],
                     a["published_at"], a["available_at"]),
                )
            counts["news"] = len(articles)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ReliefWeb refresh degraded: %s", exc)
    else:
        logger.info("RELIEFWEB_APPNAME unset — ReliefWeb overlay skipped")

    return counts
