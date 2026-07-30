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
  - GDELT DOC 2.0 (key-free): Horn-of-Africa news → news_documents → E3 signals.
  - ReliefWeb API (optional registered appname): additive news overlay.
  - GDACS (key-free): flood/drought alerts → hazard_bulletins (country→zones).
  - FAO locust remains seeded-only (no clean key-free JSON API).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime, timedelta
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


def normalize_hdx_app_identifier(raw: str) -> str:
    """HAPI expects a base64 ``app:email`` token, not the plaintext form.

    Accepts either:
      - already-encoded identifier (``HDX_APP_ENCODED`` / encoded ``HDX_APP_IDENTIFIER``)
      - plaintext ``app:email`` (auto-encoded)
    See https://hapi.humdata.org/docs#/Generate%20App%20Identifier
    """
    import base64
    import binascii
    import re

    value = (raw or "").strip()
    if not value:
        return ""
    # Prefer explicit encoded env when the caller passed the plaintext default.
    encoded_env = os.environ.get("HDX_APP_ENCODED", "").strip()
    if encoded_env and (":" in value) and "@" in value:
        return encoded_env
    if ":" in value and "@" in value and not re.fullmatch(r"[A-Za-z0-9+/=]+", value):
        return base64.b64encode(value.encode("utf-8")).decode("ascii")
    try:
        decoded = base64.b64decode(value, validate=True).decode("utf-8")
        if ":" in decoded:
            return value
    except (binascii.Error, UnicodeDecodeError):
        pass
    if ":" in value:
        return base64.b64encode(value.encode("utf-8")).decode("ascii")
    return value


class HdxHapiAdapter:
    """HDX Humanitarian API — one connector, three CEWARN indicator families.

    Requires HDX_APP_IDENTIFIER (base64 "app:email", free self-service:
    https://hapi.humdata.org/docs#/Generate%20App%20Identifier).
    Plaintext ``app:email`` is auto-encoded; ``HDX_APP_ENCODED`` wins when set.
    """

    BASE = "https://hapi.humdata.org/api/v2"

    def __init__(self, app_identifier: str | None = None) -> None:
        raw = app_identifier
        if raw is None:
            raw = os.environ.get("HDX_APP_ENCODED") or os.environ.get("HDX_APP_IDENTIFIER", "")
        self.app_identifier = normalize_hdx_app_identifier(raw)

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


class GdeltNewsAdapter:
    """GDELT DOC 2.0 ArtList → news_documents (E3 LLM extraction does the rest).

    Key-free public API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
    ArtList returns title/url/domain (no fulltext) — we store a compact body
    stub so E3 still has enough text for signal extraction.
    """

    BASE = "https://api.gdeltproject.org/api/v2/doc/doc"
    DEFAULT_QUERY = (
        "(Kenya OR Ethiopia OR Somalia OR \"South Sudan\" OR Sudan OR Uganda "
        "OR Djibouti OR Eritrea OR Mandera OR \"Horn of Africa\") "
        "(drought OR flood OR conflict OR displacement OR pastoralist OR famine "
        "OR IPC OR \"food insecurity\" OR locust)"
    )

    def available(self) -> bool:
        return True

    def fetch_articles(
        self,
        query: str | None = None,
        *,
        maxrecords: int = 40,
        timespan: str = "14d",
    ) -> list[dict[str, Any]]:
        import httpx

        params = {
            "query": query or self.DEFAULT_QUERY,
            "mode": "ArtList",
            "format": "json",
            "maxrecords": max(1, min(250, maxrecords)),
            "timespan": timespan,
            "sort": "DateDesc",
        }
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            resp = client.get(self.BASE, params=params)
            resp.raise_for_status()
            payload = resp.json()
        articles: list[dict[str, Any]] = []
        for item in payload.get("articles") or []:
            title = (item.get("title") or "").strip()
            url = (item.get("url") or "").strip()
            if not title or not url:
                continue
            domain = str(item.get("domain") or "gdelt")
            country = str(item.get("sourcecountry") or "")
            published = _gdelt_seendate_to_iso(item.get("seendate"))
            body = (
                f"{title}\n\nSource: {domain}"
                + (f" ({country})" if country else "")
                + f"\nURL: {url}"
            )
            articles.append({
                "id": f"gdelt-{_stable_slug(url)}",
                "title": title[:500],
                "body": body[:8000],
                "source": f"GDELT/{domain}",
                "url": url,
                "published_at": published,
                "available_at": _now_iso(),
                "provenance": {
                    "provider": "gdelt",
                    "domain": domain,
                    "sourcecountry": country or None,
                },
            })
        return articles


class ReliefWebNewsAdapter:
    """Primary live news source (clean humanitarian reports + stable URLs).

    Requires RELIEFWEB_APPNAME. GDELT is the secondary overlay.
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

    def fetch_articles(
        self, query: str = "drought OR conflict OR displacement OR flood", limit: int = 40
    ) -> list[dict[str, Any]]:
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
            raw_url = fields.get("url")
            if isinstance(raw_url, dict):
                url = str(raw_url.get("href") or raw_url.get("url") or "").strip() or None
            else:
                url = str(raw_url or "").strip() or None
            articles.append({
                "id": f"reliefweb-{item.get('id')}",
                "title": fields.get("title") or "(untitled)",
                "body": body_text[:8000],
                "source": (sources[0].get("name") if sources else "ReliefWeb"),
                "url": url,
                "published_at": created,
                "available_at": _now_iso(),
                "provenance": {
                    "provider": "reliefweb",
                    "reliefweb_id": item.get("id"),
                },
            })
        return articles


_GDACS_EVENT_TO_HAZARD = {
    "FL": "flood",
    "DR": "drought",
}
_GDACS_ALERT_TO_SEVERITY = {
    "green": "advisory",
    "orange": "watch",
    "red": "warning",
}


class GdacsHazardAdapter:
    """GDACS SEARCH GeoJSON → hazard_bulletins (flood / drought).

    Key-free: https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH
    Country-level events fan out to every Dira zone in that ISO2 country.
    """

    BASE = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    IGAD_ISO3 = set(ISO2_TO_ISO3.values())

    def available(self) -> bool:
        return True

    def fetch_events(
        self,
        *,
        lookback_days: int = 180,
    ) -> list[dict[str, Any]]:
        import httpx

        today = datetime.now(UTC).date()
        params = {
            "eventlist": "FL;DR",
            "fromdate": (today - timedelta(days=lookback_days)).isoformat(),
            "todate": today.isoformat(),
            "alertlevel": "Green;Orange;Red",
        }
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            resp = client.get(self.BASE, params=params)
            resp.raise_for_status()
            payload = resp.json()
        events: list[dict[str, Any]] = []
        for feature in payload.get("features") or []:
            props = feature.get("properties") or {}
            event_type = str(props.get("eventtype") or "").upper()
            hazard_type = _GDACS_EVENT_TO_HAZARD.get(event_type)
            if hazard_type is None:
                continue
            iso3 = str(props.get("iso3") or "").upper()
            affected = props.get("affectedcountries") or []
            iso3_hits = {
                str(c.get("iso3") or "").upper()
                for c in affected
                if isinstance(c, dict)
            }
            if iso3:
                iso3_hits.add(iso3)
            igad_hits = iso3_hits & self.IGAD_ISO3
            if not igad_hits:
                continue
            iso3_list = sorted(igad_hits)
            alert = str(props.get("alertlevel") or "Green").lower()
            severity = _GDACS_ALERT_TO_SEVERITY.get(alert, "advisory")
            name = (
                props.get("name")
                or props.get("description")
                or props.get("htmldescription")
                or f"{hazard_type} alert"
            )
            valid_from = str(props.get("fromdate") or "")[:10]
            valid_to = str(props.get("todate") or "")[:10] or None
            if not valid_from:
                valid_from = datetime.now(UTC).strftime("%Y-%m-%d")
            event_id = props.get("eventid")
            episode = props.get("episodeid")
            detail_bits = [
                str(props.get("htmldescription") or props.get("description") or "").strip(),
                f"GDACS alert={props.get('alertlevel')}",
                f"source={props.get('source') or 'GDACS'}",
            ]
            report_url = (props.get("url") or {}).get("report") if isinstance(
                props.get("url"), dict
            ) else None
            if report_url:
                detail_bits.append(str(report_url))
            for target_iso3 in iso3_list:
                events.append({
                    "event_key": f"{event_type}-{event_id}-{episode}-{target_iso3}",
                    "iso3": target_iso3,
                    "hazard_type": hazard_type,
                    "severity": severity,
                    "headline": str(name)[:240],
                    "detail": " | ".join(b for b in detail_bits if b)[:2000],
                    "valid_from": valid_from,
                    "valid_to": valid_to,
                    "source": "gdacs_live",
                    "url": str(report_url) if report_url else None,
                    "available_at": _now_iso(),
                })
        return events

    def bulletin_rows(
        self, events: list[dict[str, Any]], zones_by_iso2: dict[str, list[str]]
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for event in events:
            iso2 = ISO3_TO_ISO2.get(event["iso3"])
            if not iso2:
                continue
            for zone_id in zones_by_iso2.get(iso2, []):
                rows.append({
                    "zone_id": zone_id,
                    "hazard_type": event["hazard_type"],
                    "severity": event["severity"],
                    "headline": event["headline"],
                    "detail": event["detail"],
                    "valid_from": event["valid_from"],
                    "valid_to": event.get("valid_to"),
                    "source": event["source"],
                    "url": event.get("url"),
                    "available_at": event["available_at"],
                    "external_key": f"{zone_id}:{event['event_key']}",
                })
        return rows


def _gdelt_seendate_to_iso(raw: Any) -> str:
    """GDELT seendate looks like ``20260722T100000Z`` → ISO-8601."""
    text = str(raw or "").strip()
    if len(text) >= 15 and text[8] == "T":
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}T{text[9:11]}:{text[11:13]}:{text[13:15]}Z"
    return _now_iso()


def _stable_slug(url: str) -> str:
    import hashlib

    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]


def _insert_news_articles(cur: Any, articles: list[dict[str, Any]]) -> int:
    import json

    inserted = 0
    for a in articles:
        provenance = a.get("provenance") or {}
        cur.execute(
            """
            INSERT INTO news_documents (
              external_id, title, body, source, url, provenance,
              published_at, available_at
            ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
            ON CONFLICT (external_id) DO UPDATE SET
              title = EXCLUDED.title,
              body = EXCLUDED.body,
              source = EXCLUDED.source,
              url = COALESCE(EXCLUDED.url, news_documents.url),
              provenance = CASE
                WHEN EXCLUDED.provenance = '{}'::jsonb THEN news_documents.provenance
                ELSE EXCLUDED.provenance
              END,
              published_at = EXCLUDED.published_at,
              available_at = EXCLUDED.available_at
            """,
            (
                a["id"],
                a["title"],
                a["body"],
                a["source"],
                a.get("url"),
                json.dumps(provenance),
                a["published_at"],
                a["available_at"],
            ),
        )
        inserted += 1
    return inserted


def _zones_by_iso2(cur: Any) -> dict[str, list[str]]:
    cur.execute("SELECT id, country_iso2 FROM zones ORDER BY id")
    out: dict[str, list[str]] = {}
    for row in cur.fetchall():
        data = dict(row) if hasattr(row, "keys") else {"id": row[0], "country_iso2": row[1]}
        iso2 = str(data.get("country_iso2") or "")
        zid = str(data.get("id") or "")
        if iso2 and zid:
            out.setdefault(iso2, []).append(zid)
    return out


def refresh_information_layer_live(cur: Any) -> dict[str, int]:
    """Overlay live rows on top of the seeded baseline. Per-connector
    degradation: one failing source never blocks the others."""
    from dira_data.context import (
        upsert_displacement,
        upsert_food_security,
        upsert_hazard_bulletins,
        upsert_market_prices,
    )

    counts = {
        "food_security": 0,
        "displacement": 0,
        "market_prices": 0,
        "news": 0,
        "hazard_bulletins": 0,
    }
    zone_map = load_zone_admin_map()

    if zone_map:
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
    else:
        logger.info("No zone_admin_map.json entries — HAPI overlay skipped")

    # Primary live news: ReliefWeb (clean reports + URLs). GDELT is secondary.
    reliefweb = ReliefWebNewsAdapter()
    if reliefweb.available():
        try:
            rw_articles = reliefweb.fetch_articles()
            counts["news"] += _insert_news_articles(cur, rw_articles)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ReliefWeb refresh degraded: %s", exc)
    else:
        logger.info("RELIEFWEB_APPNAME unset — ReliefWeb skipped")

    gdelt = GdeltNewsAdapter()
    try:
        articles = gdelt.fetch_articles()
        counts["news"] += _insert_news_articles(cur, articles)
    except Exception as exc:  # noqa: BLE001
        logger.warning("GDELT refresh degraded: %s", exc)

    # Live hazard bulletins: GDACS flood/drought → IGAD zones.
    gdacs = GdacsHazardAdapter()
    try:
        events = gdacs.fetch_events()
        zones = _zones_by_iso2(cur)
        bulletins = gdacs.bulletin_rows(events, zones)
        upsert_hazard_bulletins(cur, bulletins)
        counts["hazard_bulletins"] = len(bulletins)
    except Exception as exc:  # noqa: BLE001
        logger.warning("GDACS hazard refresh degraded: %s", exc)

    return counts
