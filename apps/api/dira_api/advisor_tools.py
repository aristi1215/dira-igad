"""Safe advisor read tools and operator-gated proposal tools."""

from __future__ import annotations

from typing import Any

from dira_data.retrieval import search_corpus

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_corpus",
            "description": "Find grounded source passages relevant to a question.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
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
]


def _select(conn: Any, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


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
    return {"rows": rows}


def _read_zone_context(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "rows": _select(
            conn,
            "SELECT * FROM v_zone_context WHERE zone_id = %s",
            (args["zone_id"],),
        )
    }


def _query_news_signals(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "rows": _select(
            conn,
            """
            SELECT ns.signal_type, ns.excerpt, ns.status, nd.title, nd.source,
                   nd.published_at
            FROM news_signals ns
            LEFT JOIN news_documents nd ON nd.id = ns.document_id
            WHERE ns.zone_id = %s AND nd.available_at <= now()
            ORDER BY ns.cycle DESC LIMIT 5
            """,
            (args["zone_id"],),
        )
    }


def _query_hazards(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "rows": _select(
            conn,
            """
            SELECT hazard_type, severity, headline, detail, source, valid_from, valid_to
            FROM hazard_bulletins
            WHERE zone_id = %s AND available_at <= now()
            ORDER BY valid_from DESC LIMIT 5
            """,
            (args["zone_id"],),
        )
    }


def _query_field_reports(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "rows": _select(
            conn,
            """
            SELECT id, reporter_role, category, severity, narrative, status, reported_at
            FROM field_reports
            WHERE zone_id = %s AND available_at <= now()
            ORDER BY reported_at DESC LIMIT 5
            """,
            (args["zone_id"],),
        )
    }


def _read_watchlist(conn: Any, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "rows": _select(
            conn,
            """
            SELECT zone_id, zone_name, operational_band, model_risk
            FROM v_map_situations ORDER BY model_risk DESC LIMIT 8
            """,
        )
    }


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
    return {
        "type": "alert-draft",
        "situation_id": args["situation_id"],
        "language": args.get("language", "sw"),
    }


TOOL_HANDLERS: dict[str, Any] = {
    "search_corpus": _search_corpus,
    "read_situation": _read_situation,
    "read_zone_context": _read_zone_context,
    "query_news_signals": _query_news_signals,
    "query_hazards": _query_hazards,
    "query_field_reports": _query_field_reports,
    "read_watchlist": _read_watchlist,
    "list_pending_alerts": _list_pending_alerts,
    "read_model_card": _read_model_card,
    "propose_verify_field_report": _propose_verify_field_report,
    "propose_alert_draft": _propose_alert_draft,
}
