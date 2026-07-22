"""FastAPI application — routes, webhooks, SSE."""

from __future__ import annotations

import logging
import select
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from dira_core.alerts import derive_idempotency_key
from dira_data.db import connect
from dira_llm import ALERT_DRAFT_SYSTEM, CannedResponseAdapter
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from dira_api.settings import Settings, get_settings

logger = logging.getLogger("dira.api")

app = FastAPI(
    title="Dira API",
    description="Causal situation room for the Horn of Africa",
    version="0.1.0",
)

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


def _settings() -> Settings:
    return get_settings()


def _verify_webhook_secret(
    settings: Settings, provided_secret: str | None
) -> None:
    if settings.webhook_shared_secret and provided_secret != settings.webhook_shared_secret:
        raise HTTPException(403, "Invalid webhook secret")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "dira-api"}


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
                       exposure_snapshot, prob_conflict, expected_incidents
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
                       prob_conflict, expected_incidents, created_at
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
    llm = CannedResponseAdapter()
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, zone_id FROM situations WHERE id = %s", (situation_id,))
            sit = cur.fetchone()
            if sit is None:
                raise HTTPException(404, "Situation not found")
            cur.execute(
                """
                SELECT explanation, operational_band FROM assessments
                WHERE situation_id = %s ORDER BY cycle DESC LIMIT 1
                """,
                (situation_id,),
            )
            latest = cur.fetchone()
        draft = llm.complete_json(
            f"Draft alert for zone {sit['zone_id']} band={latest and latest['operational_band']}",
            system=ALERT_DRAFT_SYSTEM,
        )
        text = str(draft.get("body_text") or draft.get("text") or "Tahadhari ya hali.")
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO alerts (situation_id, status, language, body_text, created_by)
                    VALUES (%s, 'pending_approval', %s, %s, %s)
                    RETURNING id, status, body_text, language, created_at
                    """,
                    (situation_id, body.language, text, body.created_by),
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


@app.post("/webhooks/at/dtmf")
async def webhook_dtmf(
    payload: dict[str, Any],
    x_dira_webhook_secret: str | None = Header(default=None),
) -> dict[str, str]:
    """Africa's Talking DTMF callback. Unknown sessionId → 200, no mutation."""
    settings = _settings()
    _verify_webhook_secret(settings, x_dira_webhook_secret)
    session_id = (
        payload.get("sessionId")
        or payload.get("provider_message_id")
        or payload.get("callSessionState")
    )
    digit = str(payload.get("dtmfDigits") or payload.get("digit") or "")
    if not session_id:
        return {"status": "ignored"}

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
                    return {"status": "ignored"}
                # Idempotent: repeating DTMF keeps the first meaningful ack
                if row["ack_status"] != "none" and ack_status != "none":
                    return {"status": "ok"}
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
    return {"status": "ok"}


@app.post("/webhooks/at/status")
async def webhook_status(
    payload: dict[str, Any],
    x_dira_webhook_secret: str | None = Header(default=None),
) -> dict[str, str]:
    settings = _settings()
    _verify_webhook_secret(settings, x_dira_webhook_secret)
    provider_message_id = payload.get("sessionId") or payload.get("provider_message_id")
    status = str(payload.get("status") or "").lower()
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
            conn.add_notice_handler(lambda *a, **k: None)
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("LISTEN dira_events")
            while True:
                if select.select([conn], [], [], 15.0) == ([], [], []):
                    yield "event: heartbeat\ndata: {}\n\n"
                    continue
                conn.poll()
                while conn.notifies:
                    note = conn.notifies.pop(0)
                    yield f"event: dira\ndata: {note.payload}\n\n"

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
