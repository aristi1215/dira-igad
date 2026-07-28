"""FastAPI application — routes, webhooks, SSE."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from dira_core.alerts import derive_idempotency_key
from dira_data.db import connect
from dira_data.economy import get_economy_source
from dira_llm import ALERT_DRAFT_SYSTEM, CannedResponseAdapter, get_language_model
from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from dira_api.context_routes import router as context_router
from dira_api.settings import Settings, get_settings

logger = logging.getLogger("dira.api")

app = FastAPI(
    title="Dira API",
    description="Causal situation room for the Horn of Africa",
    version="0.2.0",
)
app.include_router(context_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ApproveBody(BaseModel):
    approved_by: str = Field(min_length=1)


class AlertDraftBody(BaseModel):
    created_by: str = "advisor"
    language: str = "sw"


class RetryBody(BaseModel):
    pass


class AdvisorBody(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    situation_id: UUID | None = None
    zone_id: str | None = None
    conversation_id: UUID | None = None


def _settings() -> Settings:
    return get_settings()


def _language_model() -> Any:
    settings = _settings()
    return get_language_model(
        openai_api_key=settings.openai_api_key,
        anthropic_api_key=settings.anthropic_api_key,
    )


def _verify_webhook_secret(
    settings: Settings, provided_secret: str | None
) -> None:
    if settings.webhook_shared_secret and provided_secret != settings.webhook_shared_secret:
        raise HTTPException(403, "Invalid webhook secret")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "dira-api"}


AUDIO_DIR = Path(__file__).resolve().parents[3] / "artifacts" / "audio"


@app.get("/audio/{filename}")
def serve_audio(filename: str) -> FileResponse:
    """Serve synthesized alert audio (ElevenLabs mp3s) for Twilio <Play>."""
    if "/" in filename or ".." in filename:
        raise HTTPException(404, "Not found")
    path = AUDIO_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="audio/mpeg")


@app.get("/map/situations")
def map_situations() -> dict[str, Any]:
    """GeoJSON FeatureCollection from v_map_situations."""
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT situation_id, zone_id, hazard, situation_status, zone_name,
                       country_iso2, ST_AsGeoJSON(geom)::json AS geometry,
                       assessment_id, cycle, model_risk, model_band, corroboration,
                       operational_band, explanation, combination_rule, shap,
                       exposure_snapshot, prob_conflict, expected_incidents,
                       horizon_dekads, window_start, window_end
                FROM v_map_situations
                """
            )
            rows = cur.fetchall()

    features = []
    for r in rows:
        props = {k: r[k] for k in r.keys() if k != "geometry"}
        # JSON-serialize UUIDs/dates
        for k, v in list(props.items()):
            if hasattr(v, "isoformat"):
                props[k] = v.isoformat()
            elif isinstance(v, UUID):
                props[k] = str(v)
        features.append(
            {
                "type": "Feature",
                "geometry": r["geometry"],
                "properties": props,
            }
        )
    return {"type": "FeatureCollection", "features": features}


@app.get("/situations/{situation_id}")
def situation_detail(situation_id: UUID) -> dict[str, Any]:
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, zone_id, hazard, status, opened_cycle, resolved_cycle,
                       cycles_below_threshold, created_at, updated_at
                FROM situations WHERE id = %s
                """,
                (situation_id,),
            )
            sit = cur.fetchone()
            if sit is None:
                raise HTTPException(404, "Situation not found")
            cur.execute(
                """
                SELECT id, cycle, model_risk, model_band, corroboration, operational_band,
                       combination_rule, explanation, shap, exposure_snapshot,
                       prob_conflict, expected_incidents, created_at,
                       horizon_dekads, window_start, window_end
                FROM assessments
                WHERE situation_id = %s
                ORDER BY cycle
                """,
                (situation_id,),
            )
            assessments = cur.fetchall()
    return {
        "situation": _jsonable(dict(sit)),
        "assessments": [_jsonable(dict(a)) for a in assessments],
    }


@app.post("/situations/{situation_id}/alert")
def create_alert_draft(situation_id: UUID, body: AlertDraftBody) -> dict[str, Any]:
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, zone_id FROM situations WHERE id = %s", (situation_id,))
            sit = cur.fetchone()
            if sit is None:
                raise HTTPException(404, "Situation not found")
            cur.execute(
                """
                SELECT explanation, operational_band, window_start, window_end
                FROM assessments
                WHERE situation_id = %s ORDER BY cycle DESC LIMIT 1
                """,
                (situation_id,),
            )
            latest = cur.fetchone()
        prompt = (
            f"Draft alert for zone {sit['zone_id']} "
            f"band={latest and latest['operational_band']}. "
            f"Model explanation: {latest and latest['explanation']}. "
            f'Return JSON {{"language": "{body.language}", "body_text": "..."}} '
            f"with body_text in language code '{body.language}', under 320 characters."
        )
        try:
            draft = _language_model().complete_json(prompt, system=ALERT_DRAFT_SYSTEM)
        except Exception:
            logger.exception("LLM draft failed; using canned fallback")
            draft = CannedResponseAdapter().complete_json(prompt, system=ALERT_DRAFT_SYSTEM)
        text = str(draft.get("body_text") or draft.get("text") or "Tahadhari ya hali.")
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO alerts (
                      situation_id, status, language, body_text, created_by,
                      window_start, window_end
                    )
                    VALUES (%s, 'pending_approval', %s, %s, %s, %s, %s)
                    RETURNING id, status, body_text, language, created_at,
                              window_start, window_end
                    """,
                    (
                        situation_id,
                        body.language,
                        text,
                        body.created_by,
                        latest and latest["window_start"],
                        latest and latest["window_end"],
                    ),
                )
                row = cur.fetchone()
    return _jsonable(dict(row))


@app.post("/alerts/{alert_id}/approve")
def approve_alert(
    alert_id: UUID,
    body: ApproveBody,
    x_dira_user: str | None = Header(default=None),
) -> dict[str, Any]:
    """Durable promise: approve + insert all deliveries atomically (§5.1)."""
    signer = body.approved_by or x_dira_user
    if not signer:
        raise HTTPException(400, "approved_by required")

    with connect(_settings().database_url) as conn:
        try:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT a.id, a.status, a.situation_id, s.zone_id
                        FROM alerts a
                        JOIN situations s ON s.id = a.situation_id
                        WHERE a.id = %s
                        FOR UPDATE OF a
                        """,
                        (alert_id,),
                    )
                    alert = cur.fetchone()
                    if alert is None:
                        raise HTTPException(404, "Alert not found")
                    if alert["status"] != "pending_approval":
                        raise HTTPException(409, f"Alert status is {alert['status']}")

                    now = datetime.now(UTC)
                    cur.execute(
                        """
                        UPDATE alerts
                        SET status = 'approved',
                            approved_by = %s,
                            approved_at = %s,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        (signer, now, alert_id),
                    )

                    cur.execute(
                        """
                        SELECT id, channel FROM recipients
                        WHERE active = TRUE AND (zone_id = %s OR zone_id IS NULL)
                        """,
                        (alert["zone_id"],),
                    )
                    recipients = cur.fetchall()
                    expected_delivery_count = len(recipients)
                    for rec in recipients:
                        idem = derive_idempotency_key(
                            str(alert_id), str(rec["id"]), str(rec["channel"])
                        )
                        cur.execute(
                            """
                            INSERT INTO deliveries (
                              alert_id, recipient_id, channel, idempotency_key, status
                            ) VALUES (%s, %s, %s, %s, 'queued')
                            ON CONFLICT (idempotency_key) DO NOTHING
                            """,
                            (alert_id, rec["id"], rec["channel"], idem),
                        )
                    cur.execute(
                        "SELECT count(*) AS count FROM deliveries WHERE alert_id = %s",
                        (alert_id,),
                    )
                    delivery_count = int(cur.fetchone()["count"])
                    if delivery_count != expected_delivery_count:
                        raise RuntimeError(
                            "Approval did not queue deliveries for every active recipient"
                        )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Approve failed")
            raise HTTPException(500, str(exc)) from exc

    return {"id": str(alert_id), "status": "approved", "approved_by": signer}


@app.get("/alerts")
def list_alerts(status: str | None = Query(default=None)) -> list[dict[str, Any]]:
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            query = """
                SELECT a.id, a.situation_id, a.status, a.language, a.body_text,
                       a.created_by, a.approved_by, a.approved_at, a.created_at,
                       a.window_start, a.window_end,
                       s.zone_id, z.name AS zone_name
                FROM alerts a
                JOIN situations s ON s.id = a.situation_id
                JOIN zones z ON z.id = s.zone_id
            """
            if status:
                cur.execute(query + " WHERE a.status = %s ORDER BY a.created_at DESC", (status,))
            else:
                cur.execute(query + " ORDER BY a.created_at DESC LIMIT 200")
            return [_jsonable(dict(r)) for r in cur.fetchall()]


@app.get("/zones/{zone_id}/signals")
def zone_signals(zone_id: str) -> list[dict[str, Any]]:
    """Unconfirmed-first news signals with their source documents for a zone."""
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (ns.document_id)
                       ns.id, ns.zone_id, ns.signal_type, ns.confidence, ns.status,
                       ns.excerpt, ns.cycle, nd.title, nd.source, nd.published_at
                FROM news_signals ns
                LEFT JOIN news_documents nd ON nd.id = ns.document_id
                WHERE ns.zone_id = %s
                ORDER BY ns.document_id, ns.cycle DESC, ns.confidence DESC
                LIMIT 20
                """,
                (zone_id,),
            )
            return [_jsonable(dict(r)) for r in cur.fetchall()]


@app.get("/economy")
def economy() -> dict[str, Any]:
    """IGAD country economy indicators (seeded snapshot or live World Bank),
    enriched with UNHCR refugees-hosted figures when running live."""
    settings = _settings()
    payload = get_economy_source(settings.data_mode).indicators()
    if settings.data_mode == "live":
        try:
            from dira_data.live import UnhcrRefugeeAdapter

            for iso2, figures in UnhcrRefugeeAdapter().country_refugees().items():
                country = payload.get("countries", {}).get(iso2)
                if country is not None:
                    country["refugees_hosted"] = figures["refugees_hosted"]
                    country["refugees_year"] = figures["year"]
            payload["source"] += " + UNHCR population API"
        except Exception:
            logger.exception("UNHCR refresh failed; serving base economy payload")
    return payload


ADVISOR_SYSTEM = (
    "You are the Dira situation-room advisor for a governmental early-warning team "
    "in the IGAD region. Answer using only the structured context provided. Give "
    "practical, do-no-harm preparedness guidance. Never name actors, ethnicities, "
    "clans, or communities. Keep answers under 180 words."
)


def _advisor_gather(
    conn: Any, body: AdvisorBody
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    """Grounded retrieval tools — read-only queries scoped to the selected zone.
    Returns (context, citations, tools_used). Never mutates state."""
    context: dict[str, Any] = {}
    citations: list[dict[str, Any]] = []
    tools: list[str] = []
    zone_id = body.zone_id
    with conn.cursor() as cur:
        if body.situation_id:
            tools.append("read_situation")
            cur.execute(
                """
                SELECT zone_id, zone_name, operational_band, model_risk, corroboration,
                       explanation, combination_rule, exposure_snapshot,
                       window_start, window_end
                FROM v_map_situations WHERE situation_id = %s
                """,
                (body.situation_id,),
            )
            row = cur.fetchone()
            if row:
                context["situation"] = _jsonable(dict(row))
                zone_id = zone_id or str(row["zone_id"])
        if zone_id:
            tools.append("read_zone_context")
            cur.execute(
                "SELECT * FROM v_zone_context WHERE zone_id = %s",
                (zone_id,),
            )
            zc = cur.fetchone()
            if zc:
                context["zone_context"] = _jsonable(dict(zc))
            tools.append("query_news_signals")
            cur.execute(
                """
                SELECT ns.signal_type, ns.excerpt, ns.status, nd.title, nd.source,
                       nd.published_at
                FROM news_signals ns
                LEFT JOIN news_documents nd ON nd.id = ns.document_id
                WHERE ns.zone_id = %s
                ORDER BY ns.cycle DESC LIMIT 5
                """,
                (zone_id,),
            )
            signals = [_jsonable(dict(r)) for r in cur.fetchall()]
            context["news_signals"] = signals
            citations += [
                {
                    "kind": "news",
                    "title": s.get("title") or s.get("signal_type") or "news signal",
                    "source": s.get("source"),
                    "reference": s.get("published_at"),
                }
                for s in signals
            ]
            tools.append("query_hazards")
            cur.execute(
                """
                SELECT hazard_type, severity, headline, source, valid_from
                FROM hazard_bulletins WHERE zone_id = %s
                ORDER BY valid_from DESC LIMIT 5
                """,
                (zone_id,),
            )
            hazards = [_jsonable(dict(r)) for r in cur.fetchall()]
            context["hazard_bulletins"] = hazards
            citations += [
                {
                    "kind": "hazard",
                    "title": h.get("headline") or h.get("hazard_type") or "hazard",
                    "source": h.get("source"),
                    "reference": h.get("valid_from"),
                }
                for h in hazards
            ]
            tools.append("query_field_reports")
            cur.execute(
                """
                SELECT reporter_role, category, severity, status, reported_at
                FROM field_reports WHERE zone_id = %s
                ORDER BY reported_at DESC LIMIT 5
                """,
                (zone_id,),
            )
            reports = [_jsonable(dict(r)) for r in cur.fetchall()]
            context["field_reports"] = reports
            citations += [
                {
                    "kind": "field_report",
                    "title": f"{r.get('category')} ({r.get('status')})",
                    "source": r.get("reporter_role"),
                    "reference": r.get("reported_at"),
                }
                for r in reports
            ]
        if not context:
            tools.append("read_watchlist")
            cur.execute(
                """
                SELECT zone_id, zone_name, operational_band, model_risk
                FROM v_map_situations
                ORDER BY model_risk DESC LIMIT 8
                """
            )
            context = {"top_zones": [_jsonable(dict(r)) for r in cur.fetchall()]}
    return context, citations, tools


@app.post("/advisor")
def advisor(body: AdvisorBody) -> dict[str, Any]:
    """Grounded advisor: retrieval tools + multi-turn history + citations.
    Read-only — it can never approve alerts or dispatch anything."""
    with connect(_settings().database_url) as conn:
        context, citations, tools = _advisor_gather(conn, body)

        with conn.transaction():
            with conn.cursor() as cur:
                if body.conversation_id:
                    cur.execute(
                        "SELECT id FROM advisor_conversations WHERE id = %s",
                        (body.conversation_id,),
                    )
                    convo = cur.fetchone()
                    conversation_id = (
                        body.conversation_id if convo else None
                    )
                else:
                    conversation_id = None
                if conversation_id is None:
                    cur.execute(
                        "INSERT INTO advisor_conversations DEFAULT VALUES RETURNING id"
                    )
                    conversation_id = cur.fetchone()["id"]
                cur.execute(
                    """
                    SELECT role, content FROM advisor_messages
                    WHERE conversation_id = %s ORDER BY created_at DESC LIMIT 10
                    """,
                    (conversation_id,),
                )
                history = [dict(r) for r in cur.fetchall()][::-1]
                cur.execute(
                    """
                    INSERT INTO advisor_messages (conversation_id, role, content)
                    VALUES (%s, 'user', %s)
                    """,
                    (conversation_id, body.question),
                )

        history_text = "\n".join(f"{m['role']}: {m['content']}" for m in history)
        prompt = (
            f"Conversation so far:\n{history_text}\n\n"
            f"Retrieved context (tools: {', '.join(tools)}): {context}\n\n"
            f"Question: {body.question}"
        )
        llm = _language_model()
        answer: str | None = None
        if not isinstance(llm, CannedResponseAdapter):
            try:
                answer = llm.complete(prompt, system=ADVISOR_SYSTEM)
            except Exception:
                logger.exception("Advisor LLM failed; deterministic fallback")
        if not answer:
            band = (
                context.get("situation", {}).get("operational_band")
                if isinstance(context.get("situation"), dict)
                else None
            ) or "elevated"
            answer = (
                f"Advisor offline fallback: current operational band is {band}. "
                "Recommended: verify water-point functionality, brief peace committees, "
                "pre-position mediation teams along grazing corridors, and confirm alert "
                "recipients are reachable. Re-ask when the language model is available."
            )

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO advisor_messages (
                      conversation_id, role, content, citations
                    ) VALUES (%s, 'assistant', %s, %s::jsonb)
                    """,
                    (conversation_id, answer, json.dumps(citations, default=str)),
                )
                cur.execute(
                    "UPDATE advisor_conversations SET updated_at = now() WHERE id = %s",
                    (conversation_id,),
                )

    return {
        "answer": answer,
        "context": context,
        "citations": citations,
        "tools_used": tools,
        "conversation_id": str(conversation_id),
    }


@app.get("/model/card")
def model_card() -> dict[str, Any]:
    """Active model's card — what it predicts, training, accuracy, limitations."""
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT model_card FROM model_versions
                WHERE is_active = TRUE ORDER BY trained_at DESC LIMIT 1
                """
            )
            row = cur.fetchone()
    card: dict[str, Any] | None = None
    if row and row["model_card"]:
        raw = row["model_card"]
        card = raw if isinstance(raw, dict) else json.loads(raw)
    # Bootstrap registers a placeholder card without evaluation metrics; the
    # full evaluated card lives in artifacts/ until scripts/train.py re-registers.
    if card is None or "metrics" not in card:
        path = Path(__file__).resolve().parents[3] / "artifacts" / "model_card.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    if card is not None:
        return card
    raise HTTPException(404, "No trained model card available — run scripts/train.py")


@app.get("/deliveries")
def list_deliveries(
    status: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            if status:
                cur.execute(
                    """
                    SELECT id, alert_id, recipient_id, channel, status, ack_status,
                           attempt_count, provider_message_id, last_error, updated_at
                    FROM deliveries WHERE status = %s ORDER BY updated_at DESC
                    """,
                    (status,),
                )
            else:
                cur.execute(
                    """
                    SELECT id, alert_id, recipient_id, channel, status, ack_status,
                           attempt_count, provider_message_id, last_error, updated_at
                    FROM deliveries ORDER BY updated_at DESC LIMIT 200
                    """
                )
            return [_jsonable(dict(r)) for r in cur.fetchall()]


@app.post("/deliveries/{delivery_id}/retry")
def retry_delivery(delivery_id: UUID) -> dict[str, str]:
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE deliveries
                    SET status = 'queued', next_attempt_at = now(),
                        claimed_at = NULL, updated_at = now()
                    WHERE id = %s AND status = 'needs_review'
                    RETURNING id
                    """,
                    (delivery_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(404, "Delivery not in needs_review")
    return {"id": str(delivery_id), "status": "queued"}


async def _webhook_payload(request: Request) -> dict[str, Any]:
    """Twilio posts application/x-www-form-urlencoded; tests may post JSON."""
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        return dict(body) if isinstance(body, dict) else {}
    form = await request.form()
    return {key: str(value) for key, value in form.items()}


@app.post("/webhooks/twilio/gather")
async def webhook_gather(
    request: Request,
    x_dira_webhook_secret: str | None = Header(default=None),
    secret: str | None = Query(default=None),
) -> Response:
    """Twilio <Gather> DTMF callback. Unknown CallSid → 200, no mutation."""
    settings = _settings()
    _verify_webhook_secret(settings, x_dira_webhook_secret or secret)
    payload = await _webhook_payload(request)
    session_id = payload.get("CallSid") or payload.get("provider_message_id")
    digit = str(payload.get("Digits") or payload.get("digit") or "")
    twiml_ok = Response(
        content=(
            '<?xml version="1.0" encoding="UTF-8"?><Response>'
            '<Say language="sw-KE">Asante. Taarifa yako imepokelewa.</Say></Response>'
        ),
        media_type="text/xml",
    )
    if not session_id:
        return twiml_ok

    ack_status = "none"
    ack_method = None
    if digit.startswith("1"):
        ack_status = "acknowledged"
        ack_method = "dtmf_1"
    elif digit.startswith("2"):
        ack_status = "conflict_reported"
        ack_method = "dtmf_2"
    elif digit.startswith("3"):
        ack_status = "resolved"
        ack_method = "dtmf_3"
    elif digit.startswith("9"):
        ack_status = "none"
        ack_method = "dtmf_9"

    with connect(settings.database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, ack_status FROM deliveries WHERE provider_message_id = %s",
                    (session_id,),
                )
                row = cur.fetchone()
                if row is None:
                    # Unknown session — accept but mutate nothing (anti-spoof)
                    return twiml_ok
                # Idempotent: repeating DTMF keeps the first meaningful ack
                if row["ack_status"] != "none" and ack_status != "none":
                    return twiml_ok
                cur.execute(
                    """
                    UPDATE deliveries
                    SET ack_status = CASE
                          WHEN ack_status = 'none' THEN %s ELSE ack_status END,
                        ack_method = COALESCE(ack_method, %s),
                        status = CASE
                          WHEN %s = 'acknowledged' THEN 'delivered' ELSE status END,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (ack_status, ack_method, ack_status, row["id"]),
                )
    return twiml_ok


@app.post("/webhooks/twilio/status")
async def webhook_status(
    request: Request,
    x_dira_webhook_secret: str | None = Header(default=None),
    secret: str | None = Query(default=None),
) -> dict[str, str]:
    settings = _settings()
    _verify_webhook_secret(settings, x_dira_webhook_secret or secret)
    payload = await _webhook_payload(request)
    provider_message_id = payload.get("CallSid") or payload.get("provider_message_id")
    status = str(payload.get("CallStatus") or payload.get("status") or "").lower()
    if not provider_message_id:
        return {"status": "ignored"}
    mapped = None
    if status in {"completed", "success", "delivered"}:
        mapped = "delivered"
    elif status in {"failed", "busy", "no-answer"}:
        mapped = "failed"
    if mapped is None:
        return {"status": "ignored"}
    with connect(settings.database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE deliveries
                    SET status = %s, updated_at = now()
                    WHERE provider_message_id = %s
                    """,
                    (mapped, provider_message_id),
                )
                if cur.rowcount == 0:
                    return {"status": "ignored"}
    return {"status": "ok"}


@app.get("/events")
async def sse_events() -> StreamingResponse:
    """SSE relay of Postgres LISTEN dira_events with 15s heartbeats."""

    def event_stream() -> Any:
        settings = _settings()
        with connect(settings.database_url) as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("LISTEN dira_events")
            while True:
                got_any = False
                # psycopg3 generator API: yields until the timeout elapses.
                for note in conn.notifies(timeout=15.0):
                    got_any = True
                    yield f"event: dira\ndata: {note.payload}\n\n"
                if not got_any:
                    yield "event: heartbeat\ndata: {}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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


def run() -> None:
    import uvicorn

    uvicorn.run("dira_api.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    run()
