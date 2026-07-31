"""Safe advisor read tools and operator-gated proposal tools."""

from __future__ import annotations

from typing import Any

from dira_data.economy import get_economy_source
from dira_data.retrieval import search_corpus

from dira_api.alerts import _draft_alert_text
from dira_api.citations import CitationLedger
from dira_api.settings import get_settings

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_corpus",
            "description": (
                "Find grounded source passages relevant to a question, optionally "
                "scoped to a zone or to specific evidence kinds."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "zone_id": {"type": "string"},
                    "kinds": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["news", "hazard", "field_report", "zone_dossier"],
                        },
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_situation",
            "description": "Read one situation and its latest assessment.",
            "parameters": {
                "type": "object",
                "properties": {"situation_id": {"type": "string"}},
                "required": ["situation_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_zone_context",
            "description": "Read the current information-layer context for a zone.",
            "parameters": {
                "type": "object",
                "properties": {"zone_id": {"type": "string"}},
                "required": ["zone_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_news_signals",
            "description": "Read recent available news evidence for a zone.",
            "parameters": {
                "type": "object",
                "properties": {"zone_id": {"type": "string"}},
                "required": ["zone_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_hazards",
            "description": "Read recent available hazard bulletins for a zone.",
            "parameters": {
                "type": "object",
                "properties": {"zone_id": {"type": "string"}},
                "required": ["zone_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_field_reports",
            "description": "Read recent field reports for a zone.",
            "parameters": {
                "type": "object",
                "properties": {"zone_id": {"type": "string"}},
                "required": ["zone_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_watchlist",
            "description": "Read the highest-risk zones in the regional watchlist.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_neighbours",
            "description": (
                "Read a zone's geographic neighbours with their band, risk, IPC "
                "phase, displacement, active hazards, cross-border flag and "
                "distance. Use this for questions about a zone's surroundings or "
                "regional spillover — e.g. 'is X at risk from what's nearby'."
            ),
            "parameters": {
                "type": "object",
                "properties": {"zone_id": {"type": "string"}},
                "required": ["zone_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_zones",
            "description": (
                "Compare several named zones side by side: band, risk, IPC phase, "
                "displacement, active hazards. Use for comparative questions "
                "across specific zones."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "zone_ids": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["zone_ids"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_zone_profile",
            "description": (
                "Read a zone's dossier in depth: exposure, recent climate, "
                "incidents, IPC history, displacement, staple market prices, "
                "health surveillance and hazards. Use for depth questions about "
                "one zone (e.g. staple prices, recent events) that the standing "
                "briefing does not carry."
            ),
            "parameters": {
                "type": "object",
                "properties": {"zone_id": {"type": "string"}},
                "required": ["zone_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_trends",
            "description": (
                "Read a zone's risk trajectory across the last 6 cycles plus "
                "rain/NDVI deltas — answers 'what changed'."
            ),
            "parameters": {
                "type": "object",
                "properties": {"zone_id": {"type": "string"}},
                "required": ["zone_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_regional_overview",
            "description": (
                "Read region-wide analytics: band distribution, incidents by "
                "month, food security and displacement by country, delivery "
                "stats."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_economy",
            "description": (
                "Read IGAD country economy indicators (GDP, growth, inflation, "
                "population), optionally filtered to one country by ISO2 code."
            ),
            "parameters": {
                "type": "object",
                "properties": {"country_iso2": {"type": "string"}},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_pending_alerts",
            "description": "Read alert drafts awaiting an operator decision.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_model_card",
            "description": "Read the active model card and its limitations.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_verify_field_report",
            "description": "Suggest that an operator review a field report.",
            "parameters": {
                "type": "object",
                "properties": {
                    "report_id": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["report_id", "reason"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_alert_draft",
            "description": "Suggest creating an alert draft for operator review.",
            "parameters": {
                "type": "object",
                "properties": {
                    "situation_id": {"type": "string"},
                    "language": {"type": "string"},
                },
                "required": ["situation_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_dispatch",
            "description": (
                "Suggest dispatching a voice call or SMS alert to specific phone "
                "numbers, for an operator to confirm and send."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "situation_id": {"type": "string"},
                    "channel": {"type": "string", "enum": ["voice", "sms", "both"]},
                    "phone_numbers": {"type": "array", "items": {"type": "string"}},
                    "language": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["situation_id"],
                "additionalProperties": False,
            },
        },
    },
]


def _select(conn: Any, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def _ledger(args: dict[str, Any]) -> CitationLedger | None:
    ledger = args.get("_ledger")
    return ledger if isinstance(ledger, CitationLedger) else None


def _search_corpus(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    embedding = args.get("_query_embedding")
    if not isinstance(embedding, list):
        return {"hits": []}
    hits = search_corpus(
        conn,
        embedding,
        cutoff=args["_cutoff"],
        zone_id=args.get("zone_id"),
        kinds=args.get("kinds"),
        limit=min(max(int(args.get("limit", 6)), 1), 12),
    )
    ledger = _ledger(args)
    if ledger is not None:
        hits = list(ledger.attach_corpus(conn, hits))
    return {"hits": hits}


def _read_situation(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    rows = _select(
        conn,
        """
        SELECT s.id, s.zone_id, s.hazard, s.status, z.name AS zone_name,
               a.cycle, a.model_risk, a.operational_band, a.explanation,
               a.combination_rule, a.exposure_snapshot
        FROM situations s
        JOIN zones z ON z.id = s.zone_id
        LEFT JOIN LATERAL (
          SELECT cycle, model_risk, operational_band, explanation,
                 combination_rule, exposure_snapshot
          FROM assessments WHERE situation_id = s.id
          ORDER BY cycle DESC LIMIT 1
        ) a ON TRUE
        WHERE s.id = %s
        """,
        (args["situation_id"],),
    )
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="situation", title_key="zone_name",
            href=f"/situations/{args['situation_id']}",
        )
    return {"rows": rows}


def _read_zone_context(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    rows = _select(
        conn,
        "SELECT * FROM v_zone_context WHERE zone_id = %s",
        (args["zone_id"],),
    )
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="zone_dossier", title_key="zone_name",
            href=f"/zones/{args['zone_id']}",
        )
    return {"rows": rows}


def _query_news_signals(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    rows = _select(
        conn,
        """
        SELECT ns.signal_type, ns.excerpt, ns.status, nd.title, nd.source,
               nd.published_at, nd.url
        FROM news_signals ns
        LEFT JOIN news_documents nd ON nd.id = ns.document_id
        WHERE ns.zone_id = %s AND nd.available_at <= now()
        ORDER BY ns.cycle DESC LIMIT 5
        """,
        (args["zone_id"],),
    )
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="news", title_key="title", source_key="source", url_key="url",
        )
    return {"rows": rows}


def _query_hazards(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    rows = _select(
        conn,
        """
        SELECT hazard_type, severity, headline, detail, source, url,
               valid_from, valid_to
        FROM hazard_bulletins
        WHERE zone_id = %s AND available_at <= now()
        ORDER BY valid_from DESC LIMIT 5
        """,
        (args["zone_id"],),
    )
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="hazard", title_key="headline", source_key="source",
            url_key="url",
        )
    return {"rows": rows}


def _query_field_reports(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    rows = _select(
        conn,
        """
        SELECT id, reporter_role, category, severity, narrative, status, reported_at
        FROM field_reports
        WHERE zone_id = %s AND available_at <= now()
        ORDER BY reported_at DESC LIMIT 5
        """,
        (args["zone_id"],),
    )
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="field_report", title_key="category", source_key="reporter_role",
            href=f"/zones/{args['zone_id']}",
        )
    return {"rows": rows}


def _read_watchlist(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    rows = _select(
        conn,
        """
        SELECT zone_id, zone_name, operational_band, model_risk
        FROM v_map_situations ORDER BY model_risk DESC LIMIT 8
        """,
    )
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="zone_dossier", title_key="zone_name",
            href=lambda row: f"/zones/{row['zone_id']}",
        )
    return {"rows": rows}


def _zone_rows(conn: Any, zone_ids: list[str]) -> list[dict[str, Any]]:
    """Shared row shape for compare_zones / read_neighbours: one line of
    context per zone_id, band/risk from the latest assessment."""
    if not zone_ids:
        return []
    return _select(
        conn,
        """
        SELECT c.zone_id, c.zone_name, c.country_iso2, c.ipc_phase, c.pop_phase3_plus,
               c.idps, c.refugees, c.staple_pct_vs_3m_avg, c.staple_commodity,
               c.active_hazards, c.active_health_alerts,
               latest.operational_band, latest.model_risk
        FROM v_zone_context c
        LEFT JOIN LATERAL (
          SELECT operational_band, model_risk
          FROM assessments WHERE zone_id = c.zone_id
          ORDER BY cycle DESC LIMIT 1
        ) latest ON TRUE
        WHERE c.zone_id = ANY(%s)
        ORDER BY c.zone_id
        """,
        (zone_ids,),
    )


def _read_neighbours(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    adjacency = _select(
        conn,
        """
        SELECT neighbor_id, shared_border_m, centroid_distance_km, cross_border
        FROM zone_adjacency
        WHERE zone_id = %s
        ORDER BY centroid_distance_km
        """,
        (args["zone_id"],),
    )
    if not adjacency:
        return {"rows": []}
    by_zone = {
        row["zone_id"]: row
        for row in _zone_rows(conn, [row["neighbor_id"] for row in adjacency])
    }
    rows = [{**by_zone.get(row["neighbor_id"], {}), **row} for row in adjacency]
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="zone_dossier", title_key="zone_name",
            href=lambda row: f"/zones/{row.get('zone_id') or row['neighbor_id']}",
        )
    return {"rows": rows}


def _compare_zones(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    zone_ids = [str(z) for z in (args.get("zone_ids") or []) if z]
    rows = _zone_rows(conn, zone_ids)
    ledger = _ledger(args)
    if ledger is not None:
        ledger.attach(
            rows, kind="zone_dossier", title_key="zone_name",
            href=lambda row: f"/zones/{row['zone_id']}",
        )
    return {"rows": rows}


def _digest_profile(profile: dict[str, Any], ledger: CitationLedger | None) -> dict[str, Any]:
    """Trim the full zone dossier to what fits an advisor turn."""
    climate = profile.get("climate") or []
    incidents = profile.get("incidents_monthly") or []
    food_security = profile.get("food_security") or []
    displacement = profile.get("displacement") or []
    market_prices = profile.get("market_prices") or []
    health = profile.get("health") or []
    hazards = profile.get("hazard_bulletins") or []
    recent_events = profile.get("recent_events") or []

    recent_months = sorted({m["month"] for m in market_prices}, reverse=True)[:3]
    top_hazards = hazards[:3]
    if ledger is not None:
        zone_id = (profile.get("zone") or {}).get("id")
        ledger.attach(
            top_hazards, kind="hazard", title_key="headline", source_key="source",
            url_key="url", href=f"/zones/{zone_id}" if zone_id else None,
        )

    return {
        "zone": profile.get("zone"),
        "exposure": profile.get("exposure"),
        "climate_last_6_dekads": climate[-6:],
        "incidents_last_6_months": incidents[-6:],
        "ipc_last_4_periods": food_security[-4:],
        "displacement_last_3_snapshots": displacement[-3:],
        "staple_prices_last_3_months": [
            m for m in market_prices if m.get("month") in recent_months
        ],
        "active_health_alerts": [
            h for h in health if h.get("status") in ("alert", "outbreak")
        ],
        "top_hazards": top_hazards,
        "recent_acled_events": recent_events[:3],
    }


def _read_zone_profile(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    from dira_api.context_routes import zone_profile

    profile = zone_profile(args["zone_id"])
    return _digest_profile(profile, _ledger(args))


def _read_trends(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    risk_trend = _select(
        conn,
        """
        SELECT cycle, model_risk, operational_band
        FROM assessments WHERE zone_id = %s
        ORDER BY cycle DESC LIMIT 6
        """,
        (args["zone_id"],),
    )
    risk_trend.reverse()
    climate_trend = _select(
        conn,
        """
        SELECT dekad_start, rain_mm, ndvi_mean
        FROM zone_climate_dekadal WHERE zone_id = %s
        ORDER BY dekad_start DESC LIMIT 6
        """,
        (args["zone_id"],),
    )
    climate_trend.reverse()
    return {"risk_trend": risk_trend, "climate_trend": climate_trend}


def _read_regional_overview(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    from dira_api.context_routes import analytics_overview

    return analytics_overview()


def _read_economy(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    payload = get_economy_source(get_settings().data_mode).indicators()
    iso2 = args.get("country_iso2")
    if iso2:
        return {
            "source": payload.get("source"),
            "country_iso2": iso2,
            "indicators": payload.get("countries", {}).get(iso2),
        }
    return payload


def _list_pending_alerts(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "rows": _select(
            conn,
            """
            SELECT id, situation_id, status, language, body_text, created_at
            FROM alerts WHERE status = 'pending_approval'
            ORDER BY created_at DESC LIMIT 20
            """,
        )
    }


def _read_model_card(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "rows": _select(
            conn,
            """
            SELECT id, kind, feature_list, metrics, model_card, trained_at
            FROM model_versions WHERE is_active = TRUE
            ORDER BY trained_at DESC LIMIT 1
            """,
        )
    }


def _propose_verify_field_report(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "verify-field-report",
        "report_id": args["report_id"],
        "reason": args["reason"],
    }


def _propose_alert_draft(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    situation_id = args["situation_id"]
    language = args.get("language", "sw")
    body_text, _latest, zone_name = _draft_alert_text(conn, situation_id, language)
    return {
        "type": "alert-draft",
        "situation_id": situation_id,
        "language": language,
        "body_text": body_text,
        "zone_name": zone_name,
    }


def _propose_dispatch(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    situation_id = args["situation_id"]
    language = args.get("language", "sw")
    body_text, _latest, zone_name = _draft_alert_text(conn, situation_id, language)
    return {
        "type": "dispatch",
        "situation_id": situation_id,
        "channel": args.get("channel", "voice"),
        "phone_numbers": args.get("phone_numbers") or [],
        "language": language,
        "reason": args.get("reason"),
        "body_text": body_text,
        "zone_name": zone_name,
    }


TOOL_HANDLERS: dict[str, Any] = {
    "search_corpus": _search_corpus,
    "read_situation": _read_situation,
    "read_zone_context": _read_zone_context,
    "query_news_signals": _query_news_signals,
    "query_hazards": _query_hazards,
    "query_field_reports": _query_field_reports,
    "read_watchlist": _read_watchlist,
    "read_neighbours": _read_neighbours,
    "compare_zones": _compare_zones,
    "read_zone_profile": _read_zone_profile,
    "read_trends": _read_trends,
    "read_regional_overview": _read_regional_overview,
    "read_economy": _read_economy,
    "list_pending_alerts": _list_pending_alerts,
    "read_model_card": _read_model_card,
    "propose_verify_field_report": _propose_verify_field_report,
    "propose_alert_draft": _propose_alert_draft,
    "propose_dispatch": _propose_dispatch,
}
