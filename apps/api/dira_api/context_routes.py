"""Information-layer routes: zone dossiers, regional indicators, field reports,
data-source catalog and regional analytics."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from dira_data.db import connect
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from dira_api.settings import get_settings

logger = logging.getLogger("dira.api.context")

router = APIRouter()

FIELD_REPORT_CATEGORIES = [
    "livestock_raid", "water_dispute", "pasture_dispute", "migration_influx",
    "market_disruption", "road_blockage", "peace_meeting", "armed_presence", "other",
]


class FieldReportBody(BaseModel):
    zone_id: str = Field(min_length=1)
    reporter_role: str = Field(min_length=1, max_length=64)
    category: str
    severity: int = Field(ge=1, le=3)
    narrative: str = Field(min_length=1, max_length=4000)


class VerifyBody(BaseModel):
    verified_by: str = Field(min_length=1, max_length=128)


def _jsonable(obj: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, UUID):
            out[k] = str(v)
        else:
            out[k] = v
    return out


def _rows(cur: Any) -> list[dict[str, Any]]:
    return [_jsonable(dict(r)) for r in cur.fetchall()]


def _db() -> Any:
    return connect(get_settings().database_url)


@router.get("/zones")
def list_zones() -> list[dict[str, Any]]:
    """All zones with cluster, latest indicator context and open-situation band."""
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, cl.name AS cluster_name,
                       ze.population, ze.pastoralist_share, ze.water_points, ze.markets,
                       ms.operational_band, ms.model_risk, ms.situation_id
                FROM v_zone_context c
                JOIN zones z ON z.id = c.zone_id
                JOIN clusters cl ON cl.id = c.cluster_id
                LEFT JOIN zone_exposure ze ON ze.zone_id = c.zone_id
                LEFT JOIN LATERAL (
                  SELECT operational_band, model_risk, situation_id
                  FROM v_map_situations m
                  WHERE m.zone_id = c.zone_id
                  LIMIT 1
                ) ms ON TRUE
                ORDER BY ms.model_risk DESC NULLS LAST, c.zone_id
                """
            )
            return _rows(cur)


@router.get("/zones/{zone_id}/profile")
def zone_profile(zone_id: str) -> dict[str, Any]:
    """The full dossier: everything the system knows about one zone."""
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT z.id, z.name, z.country_iso2, z.cluster_id, cl.name AS cluster_name,
                       ST_AsGeoJSON(z.geom)::json AS geometry,
                       ST_X(z.centroid) AS lon, ST_Y(z.centroid) AS lat
                FROM zones z JOIN clusters cl ON cl.id = z.cluster_id
                WHERE z.id = %s
                """,
                (zone_id,),
            )
            zone = cur.fetchone()
            if zone is None:
                raise HTTPException(404, "Zone not found")
            zone = _jsonable(dict(zone))

            cur.execute("SELECT * FROM zone_exposure WHERE zone_id = %s", (zone_id,))
            row = cur.fetchone()
            exposure = _jsonable(dict(row)) if row else None

            cur.execute(
                """
                SELECT dekad_start, rain_mm, ndvi_mean
                FROM zone_climate_dekadal
                WHERE zone_id = %s ORDER BY dekad_start
                """,
                (zone_id,),
            )
            climate = _rows(cur)

            cur.execute(
                """
                SELECT date_trunc('month', event_date)::date AS month,
                       count(*) AS events, COALESCE(sum(fatalities), 0) AS fatalities
                FROM acled_events
                WHERE zone_id = %s
                GROUP BY 1 ORDER BY 1
                """,
                (zone_id,),
            )
            incidents = _rows(cur)

            cur.execute(
                """
                SELECT event_date, event_type, fatalities, notes
                FROM acled_events WHERE zone_id = %s
                ORDER BY event_date DESC LIMIT 12
                """,
                (zone_id,),
            )
            recent_events = _rows(cur)

            cur.execute(
                """
                SELECT period_start, period_end, ipc_phase, pop_phase3_plus, source
                FROM food_security WHERE zone_id = %s ORDER BY period_start
                """,
                (zone_id,),
            )
            food_security = _rows(cur)

            cur.execute(
                """
                SELECT snapshot_date, idps, refugees, returnees, source
                FROM displacement WHERE zone_id = %s ORDER BY snapshot_date
                """,
                (zone_id,),
            )
            displacement = _rows(cur)

            cur.execute(
                """
                SELECT market_name, month, commodity, unit, price, currency, pct_vs_3m_avg
                FROM market_prices WHERE zone_id = %s
                ORDER BY month, commodity
                """,
                (zone_id,),
            )
            market_prices = _rows(cur)

            cur.execute(
                """
                SELECT week_start, disease, cases, deaths, status
                FROM health_surveillance WHERE zone_id = %s
                ORDER BY week_start, disease
                """,
                (zone_id,),
            )
            health = _rows(cur)

            cur.execute(
                """
                SELECT id, hazard_type, severity, headline, detail, valid_from, valid_to, source
                FROM hazard_bulletins WHERE zone_id = %s
                ORDER BY valid_from DESC
                """,
                (zone_id,),
            )
            hazards = _rows(cur)

            cur.execute(
                """
                SELECT id, reporter_role, category, severity, narrative, reported_at,
                       status, verified_by, verified_at
                FROM field_reports WHERE zone_id = %s
                ORDER BY reported_at DESC LIMIT 40
                """,
                (zone_id,),
            )
            field_reports = _rows(cur)

            cur.execute(
                """
                SELECT ns.id, ns.signal_type, ns.confidence, ns.status, ns.excerpt, ns.cycle,
                       nd.title, nd.source, nd.published_at
                FROM news_signals ns
                LEFT JOIN news_documents nd ON nd.id = ns.document_id
                WHERE ns.zone_id = %s
                ORDER BY ns.cycle DESC, ns.confidence DESC LIMIT 20
                """,
                (zone_id,),
            )
            signals = _rows(cur)

            cur.execute(
                "SELECT * FROM v_map_situations WHERE zone_id = %s LIMIT 1", (zone_id,)
            )
            row = cur.fetchone()
            situation = None
            if row:
                situation = {
                    k: v for k, v in _jsonable(dict(row)).items() if k != "geom"
                }

            cur.execute(
                """
                SELECT id, name, role_or_channel, phone_e164, language, active FROM (
                  SELECT id, name, channel AS role_or_channel, phone_e164, language, active
                  FROM recipients WHERE zone_id = %s
                ) r ORDER BY name
                """,
                (zone_id,),
            )
            recipients = _rows(cur)

    return {
        "zone": zone,
        "exposure": exposure,
        "climate": climate,
        "incidents_monthly": incidents,
        "recent_events": recent_events,
        "food_security": food_security,
        "displacement": displacement,
        "market_prices": market_prices,
        "health": health,
        "hazard_bulletins": hazards,
        "field_reports": field_reports,
        "news_signals": signals,
        "situation": situation,
        "recipients": recipients,
    }


@router.get("/indicators/regional")
def regional_indicators() -> dict[str, Any]:
    """GeoJSON FeatureCollection: every zone with its latest indicator values.
    This is the map's base choropleth source — all 22 zones render even when
    no situation is open."""
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, ST_AsGeoJSON(z.geom)::json AS geometry,
                       inc.incidents_180d, inc.fatalities_180d,
                       ms.operational_band, ms.model_risk, ms.situation_id
                FROM v_zone_context c
                JOIN zones z ON z.id = c.zone_id
                LEFT JOIN LATERAL (
                  SELECT count(*) AS incidents_180d,
                         COALESCE(sum(fatalities), 0) AS fatalities_180d
                  FROM acled_events e
                  WHERE e.zone_id = c.zone_id
                    AND e.event_date >= (
                      SELECT max(event_date) - INTERVAL '180 days' FROM acled_events
                    )
                ) inc ON TRUE
                LEFT JOIN LATERAL (
                  SELECT operational_band, model_risk, situation_id
                  FROM v_map_situations m
                  WHERE m.zone_id = c.zone_id
                  LIMIT 1
                ) ms ON TRUE
                ORDER BY c.zone_id
                """
            )
            features = []
            for r in cur.fetchall():
                props = _jsonable({k: v for k, v in dict(r).items() if k != "geometry"})
                features.append(
                    {"type": "Feature", "geometry": r["geometry"], "properties": props}
                )
    return {"type": "FeatureCollection", "features": features}


@router.get("/recipients")
def list_recipients() -> list[dict[str, Any]]:
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id, r.name, r.phone_e164, r.zone_id, z.name AS zone_name,
                       r.channel, r.language, r.active
                FROM recipients r JOIN zones z ON z.id = r.zone_id
                ORDER BY z.name, r.name
                """
            )
            return _rows(cur)


def _fetch_all(conn: Any, sql: str, params: tuple[Any, ...] = ()) -> list[Any]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


@router.get("/field-reports")
def list_field_reports(
    zone_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if zone_id:
        clauses.append("fr.zone_id = %s")
        params.append(zone_id)
    if status:
        clauses.append("fr.status = %s")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT fr.*, z.name AS zone_name, z.country_iso2
                FROM field_reports fr JOIN zones z ON z.id = fr.zone_id
                {where}
                ORDER BY fr.reported_at DESC
                LIMIT %s
                """,
                (*params, limit),
            )
            return _rows(cur)


@router.post("/field-reports", status_code=201)
def create_field_report(body: FieldReportBody) -> dict[str, Any]:
    """New reports are ALWAYS born unverified — no caller can inject a
    verified report (mirrors the news-signal red line)."""
    if body.category not in FIELD_REPORT_CATEGORIES:
        raise HTTPException(422, f"category must be one of {FIELD_REPORT_CATEGORIES}")
    now = datetime.now(UTC)
    with _db() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM zones WHERE id = %s", (body.zone_id,))
                if cur.fetchone() is None:
                    raise HTTPException(404, "Zone not found")
                cur.execute(
                    """
                    INSERT INTO field_reports (
                      zone_id, reporter_role, category, severity, narrative,
                      reported_at, status, available_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, 'unverified', %s)
                    RETURNING id, zone_id, category, severity, status, reported_at
                    """,
                    (
                        body.zone_id, body.reporter_role, body.category,
                        body.severity, body.narrative, now, now,
                    ),
                )
                return _jsonable(dict(cur.fetchone()))


@router.post("/field-reports/{report_id}/verify")
def verify_field_report(report_id: UUID, body: VerifyBody) -> dict[str, Any]:
    """Human validation gate: a named person vouches for the report; only then
    can it contribute to corroboration on the next cycle."""
    with _db() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE field_reports
                    SET status = 'verified', verified_by = %s, verified_at = now()
                    WHERE id = %s AND status = 'unverified'
                    RETURNING id, zone_id, status, verified_by, verified_at
                    """,
                    (body.verified_by, report_id),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(409, "Report not found or not unverified")
                return _jsonable(dict(row))


@router.post("/field-reports/{report_id}/dismiss")
def dismiss_field_report(report_id: UUID, body: VerifyBody) -> dict[str, Any]:
    with _db() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE field_reports
                    SET status = 'dismissed', verified_by = %s, verified_at = now()
                    WHERE id = %s AND status = 'unverified'
                    RETURNING id, zone_id, status
                    """,
                    (body.verified_by, report_id),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(409, "Report not found or not unverified")
                return _jsonable(dict(row))


# --------------------------------------------------------------------------
# Data-source catalog
# --------------------------------------------------------------------------

SOURCE_CATALOG: list[dict[str, Any]] = [
    {
        "key": "acled",
        "name": "ACLED — Armed Conflict Location & Event Data",
        "category": "Conflict events",
        "live_endpoint": "acleddata.com API (OAuth)",
        "licence": "ACLED Terms of Use (attribution)",
        "cadence": "Weekly releases",
        "count_sql": "SELECT count(*), max(available_at) FROM acled_events",
    },
    {
        "key": "chirps",
        "name": "CHIRPS v3 — rainfall estimates (UCSB CHG)",
        "category": "Climate · rainfall",
        "live_endpoint": "CHIRPS dekadal COGs (public bucket)",
        "licence": "Public domain (CC0)",
        "cadence": "Dekadal (~10 days)",
        "count_sql": (
            "SELECT count(*), max(rain_available_at) FROM zone_climate_dekadal "
            "WHERE rain_mm IS NOT NULL"
        ),
    },
    {
        "key": "modis_ndvi",
        "name": "MODIS MOD13Q1 — vegetation health (NDVI)",
        "category": "Climate · vegetation",
        "live_endpoint": "NASA LP DAAC / Google Earth Engine",
        "licence": "NASA open data",
        "cadence": "16-day composites",
        "count_sql": (
            "SELECT count(*), max(ndvi_available_at) FROM zone_climate_dekadal "
            "WHERE ndvi_mean IS NOT NULL"
        ),
    },
    {
        "key": "news",
        "name": "News corpus (authorized sources) + ReliefWeb",
        "category": "Unstructured · media",
        "live_endpoint": "ReliefWeb API (key-free)",
        "licence": "Per-source; ReliefWeb open",
        "cadence": "Continuous",
        "count_sql": "SELECT count(*), max(available_at) FROM news_documents",
    },
    {
        "key": "ipc",
        "name": "IPC / FEWS NET — acute food insecurity phases",
        "category": "Food security",
        "live_endpoint": "HDX HAPI (food-security endpoint)",
        "licence": "CC BY (IPC Global Partners)",
        "cadence": "2–3 analyses per year",
        "count_sql": "SELECT count(*), max(available_at) FROM food_security",
    },
    {
        "key": "dtm",
        "name": "IOM DTM — internal displacement tracking",
        "category": "Displacement",
        "live_endpoint": "HDX HAPI (affected-people endpoint)",
        "licence": "IOM DTM terms (attribution)",
        "cadence": "Monthly rounds",
        "count_sql": "SELECT count(*), max(available_at) FROM displacement",
    },
    {
        "key": "unhcr",
        "name": "UNHCR — refugee & asylum statistics",
        "category": "Displacement",
        "live_endpoint": "api.unhcr.org (key-free)",
        "licence": "UNHCR open data",
        "cadence": "Monthly/annual",
        "count_sql": (
            "SELECT count(*), max(available_at) FROM displacement WHERE refugees > 0"
        ),
    },
    {
        "key": "wfp_prices",
        "name": "WFP VAM — market & livestock prices",
        "category": "Markets",
        "live_endpoint": "HDX HAPI (food-prices) / WFP DataBridges",
        "licence": "CC BY-NC (WFP)",
        "cadence": "Monthly",
        "count_sql": "SELECT count(*), max(available_at) FROM market_prices",
    },
    {
        "key": "who_ewars",
        "name": "Health surveillance (WHO EWARS-style)",
        "category": "Health",
        "live_endpoint": "WHO bulletins (no public API — seeded)",
        "licence": "WHO publications",
        "cadence": "Weekly epi weeks",
        "count_sql": "SELECT count(*), max(available_at) FROM health_surveillance",
    },
    {
        "key": "fao_locust",
        "name": "FAO DLIS — desert locust bulletins",
        "category": "Hazards",
        "live_endpoint": "FAO Locust Hub (ArcGIS services)",
        "licence": "FAO open data",
        "cadence": "Monthly + flash updates",
        "count_sql": (
            "SELECT count(*), max(available_at) FROM hazard_bulletins "
            "WHERE hazard_type = 'locust'"
        ),
    },
    {
        "key": "glofas",
        "name": "GloFAS / ICPAC — flood, heat & drought bulletins",
        "category": "Hazards",
        "live_endpoint": "Copernicus EWDS (CDS API token)",
        "licence": "Copernicus open licence",
        "cadence": "Daily forecasts / dekadal bulletins",
        "count_sql": (
            "SELECT count(*), max(available_at) FROM hazard_bulletins "
            "WHERE hazard_type <> 'locust'"
        ),
    },
    {
        "key": "field_reports",
        "name": "CEWARN field monitors — incident & situation reports",
        "category": "Primary reporting",
        "live_endpoint": "In-app POST /field-reports (this system)",
        "licence": "CEWARN internal",
        "cadence": "Continuous",
        "count_sql": "SELECT count(*), max(available_at) FROM field_reports",
    },
    {
        "key": "exposure",
        "name": "WorldPop + OSM — population & asset exposure",
        "category": "Exposure",
        "live_endpoint": "WorldPop API / Overpass",
        "licence": "CC BY (WorldPop), ODbL (OSM)",
        "cadence": "Annual",
        "count_sql": "SELECT count(*), max(updated_at) FROM zone_exposure",
    },
    {
        "key": "worldbank",
        "name": "World Bank WDI — macro-economic indicators",
        "category": "Economy",
        "live_endpoint": "api.worldbank.org (key-free)",
        "licence": "CC BY 4.0",
        "cadence": "Annual",
        "count_sql": None,
    },
]

LIVE_CAPABLE = {"acled", "news", "ipc", "dtm", "unhcr", "wfp_prices", "worldbank"}


@router.get("/sources")
def data_sources() -> dict[str, Any]:
    """The transparency catalog: what feeds Dira, how fresh it is, and whether
    this deployment reads it live or from the seeded snapshot."""
    settings = get_settings()
    data_mode = settings.data_mode
    out = []
    with _db() as conn:
        with conn.cursor() as cur:
            for src in SOURCE_CATALOG:
                count = None
                freshest = None
                if src["count_sql"]:
                    cur.execute(src["count_sql"])
                    row = cur.fetchone()
                    values = list(row.values()) if hasattr(row, "values") else list(row)
                    count = int(values[0]) if values and values[0] is not None else 0
                    freshest = values[1].isoformat() if len(values) > 1 and values[1] else None
                mode = (
                    "live" if (data_mode == "live" and src["key"] in LIVE_CAPABLE) else "seeded"
                )
                out.append(
                    {
                        "key": src["key"],
                        "name": src["name"],
                        "category": src["category"],
                        "mode": mode,
                        "live_capable": src["key"] in LIVE_CAPABLE,
                        "live_endpoint": src["live_endpoint"],
                        "licence": src["licence"],
                        "cadence": src["cadence"],
                        "rows": count,
                        "freshest_available_at": freshest,
                    }
                )
    return {
        "data_mode": data_mode,
        "bitemporal_note": (
            "Every observation stores both the period it describes and the moment it "
            "became available (available_at). Each assessment only reads data whose "
            "available_at precedes the cycle cutoff, so hindsight can never leak into "
            "a forecast."
        ),
        "sources": out,
    }


@router.get("/analytics/overview")
def analytics_overview() -> dict[str, Any]:
    with _db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(operational_band, 'none') AS band, count(*) AS zones
                FROM v_map_situations GROUP BY 1
                """
            )
            band_distribution = _rows(cur)

            cur.execute(
                """
                SELECT date_trunc('month', event_date)::date AS month,
                       count(*) AS events, COALESCE(sum(fatalities), 0) AS fatalities
                FROM acled_events
                WHERE event_date >= (CURRENT_DATE - INTERVAL '30 months')
                GROUP BY 1 ORDER BY 1
                """
            )
            incidents_monthly = _rows(cur)

            cur.execute(
                """
                SELECT z.cluster_id, c.dekad_start,
                       avg(c.rain_mm) AS rain_mm, avg(c.ndvi_mean) AS ndvi_mean
                FROM zone_climate_dekadal c JOIN zones z ON z.id = c.zone_id
                GROUP BY 1, 2 ORDER BY 1, 2
                """
            )
            climate_by_cluster = _rows(cur)

            cur.execute(
                """
                SELECT z.country_iso2,
                       sum(fs.pop_phase3_plus) AS pop_phase3_plus,
                       max(fs.ipc_phase) AS worst_ipc_phase
                FROM zones z
                JOIN LATERAL (
                  SELECT ipc_phase, pop_phase3_plus FROM food_security f
                  WHERE f.zone_id = z.id ORDER BY period_start DESC LIMIT 1
                ) fs ON TRUE
                GROUP BY 1 ORDER BY 1
                """
            )
            food_security_by_country = _rows(cur)

            cur.execute(
                """
                SELECT z.country_iso2,
                       sum(d.idps) AS idps, sum(d.refugees) AS refugees
                FROM zones z
                JOIN LATERAL (
                  SELECT idps, refugees FROM displacement dd
                  WHERE dd.zone_id = z.id ORDER BY snapshot_date DESC LIMIT 1
                ) d ON TRUE
                GROUP BY 1 ORDER BY 1
                """
            )
            displacement_by_country = _rows(cur)

            cur.execute(
                """
                SELECT count(*) FILTER (WHERE status = 'verified') AS verified,
                       count(*) FILTER (WHERE status = 'unverified') AS unverified,
                       count(*) FILTER (WHERE status = 'dismissed') AS dismissed
                FROM field_reports
                """
            )
            field_report_stats = _jsonable(dict(cur.fetchone()))

            cur.execute(
                """
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE ack_status <> 'none') AS acked,
                       count(*) FILTER (WHERE status = 'needs_review') AS needs_review
                FROM deliveries
                """
            )
            delivery_stats = _jsonable(dict(cur.fetchone()))

    return {
        "band_distribution": band_distribution,
        "incidents_monthly": incidents_monthly,
        "climate_by_cluster": climate_by_cluster,
        "food_security_by_country": food_security_by_country,
        "displacement_by_country": displacement_by_country,
        "field_report_stats": field_report_stats,
        "delivery_stats": delivery_stats,
    }
