"""FastAPI app — routes, webhooks, SSE. Thin: logic lives in dira_data/dira_llm.

Endpoints:
  GET  /health
  GET  /map/situations                  v_map_situations as GeoJSON
  GET  /situations/{id}                 detail + assessment history + SHAP
  POST /situations/{id}/alert           generate a draft (LLM/template) -> pending_approval
  POST /alerts/{id}/approve             durable-promise approve + insert all deliveries
  GET  /alerts/{id}/deliveries          delivery panel
  POST /deliveries/{id}/retry           needs_review -> queued (manual retry)
  POST /webhooks/at/dtmf                DTMF acknowledgement
  POST /webhooks/at/status              provider delivery-status callback
  GET  /events                          SSE relay of dira_events
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import psycopg
from dira_data.repositories import alerts as alerts_repo
from dira_data.repositories import read as read_repo
from dira_llm import alert_text
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from dira_api.deps import get_conn
from dira_api.schemas import (
    AlertDraftRequest,
    AlertDraftResponse,
    ApproveRequest,
    ApproveResponse,
    WebhookResult,
)
from dira_api.settings import get_settings
from dira_api.sse import event_source

app = FastAPI(
    title="Dira API",
    description="Causal situation room for the Horn of Africa",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATIC = Path(__file__).resolve().parent / "static"
_STATIC.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(_STATIC)), name="static")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "dira-api"}


@app.get("/map/situations")
def map_situations(conn: psycopg.Connection = Depends(get_conn)) -> dict[str, Any]:
    return read_repo.map_situations(conn)


@app.get("/situations/{situation_id}")
def situation_detail(
    situation_id: str, conn: psycopg.Connection = Depends(get_conn)
) -> dict[str, Any]:
    detail = read_repo.situation_detail(conn, situation_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="situation not found")
    return detail


@app.post("/situations/{situation_id}/alert", response_model=AlertDraftResponse)
def create_alert_draft(
    situation_id: str,
    body: AlertDraftRequest,
    conn: psycopg.Connection = Depends(get_conn),
) -> AlertDraftResponse:
    latest = read_repo.latest_assessment(conn, situation_id)
    if latest is None:
        raise HTTPException(status_code=404, detail="situation has no assessment")
    zone = read_repo.zone_name(conn, read_repo.situation_detail(conn, situation_id)["zone_id"])
    draft = _draft_text(zone, latest["operational_band"], latest["explanation"], body.language)
    alert = alerts_repo.create_draft(conn, situation_id, draft, body.language)
    return AlertDraftResponse(**alert)


def _draft_text(zone: str, band: str, explanation: str, language: str) -> str:
    """LLM in live mode; deterministic do-no-harm template otherwise (always safe)."""
    settings = get_settings()
    if settings.data_mode == "live" and settings.anthropic_api_key:
        from dira_llm import AnthropicAdapter
        from dira_llm.prompts import ALERT_SYSTEM, alert_user

        try:
            user = alert_user(zone, band, explanation)
            return AnthropicAdapter().complete(user, system=ALERT_SYSTEM)
        except Exception:
            pass  # fall back to the safe template on any LLM failure (degrade, not abort)
    return alert_text(zone, band, explanation)


@app.post("/alerts/{alert_id}/approve", response_model=ApproveResponse)
def approve_alert(
    alert_id: str,
    body: ApproveRequest,
    conn: psycopg.Connection = Depends(get_conn),
) -> ApproveResponse:
    try:
        count = alerts_repo.approve_alert(conn, alert_id, body.approved_by)
    except alerts_repo.ApprovalConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ApproveResponse(alert_id=alert_id, status="approved", deliveries_created=count)


@app.get("/alerts/{alert_id}/deliveries")
def alert_deliveries(
    alert_id: str, conn: psycopg.Connection = Depends(get_conn)
) -> list[dict[str, Any]]:
    return read_repo.deliveries_for_alert(conn, alert_id)


@app.get("/deliveries/needs-review")
def deliveries_needs_review(conn: psycopg.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return read_repo.needs_review(conn)


@app.post("/deliveries/{delivery_id}/retry")
def retry_delivery(
    delivery_id: str, conn: psycopg.Connection = Depends(get_conn)
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE deliveries SET status='queued', next_attempt_at=now(), updated_at=now() "
            "WHERE id=%s AND status='needs_review' RETURNING id",
            (delivery_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=409, detail="delivery is not in needs_review")
    return {"id": delivery_id, "status": "queued"}


@app.post("/webhooks/at/dtmf", response_model=WebhookResult)
async def webhook_dtmf(
    request: Request, conn: psycopg.Connection = Depends(get_conn)
) -> WebhookResult:
    form = await _params(request)
    session_id = form.get("sessionId", "")
    digit = (form.get("dtmfDigits") or "").strip()
    applied = alerts_repo.handle_dtmf(conn, session_id, digit)
    return WebhookResult(ok=True, applied=applied)


@app.post("/webhooks/at/status", response_model=WebhookResult)
async def webhook_status(
    request: Request, conn: psycopg.Connection = Depends(get_conn)
) -> WebhookResult:
    form = await _params(request)
    provider_id = form.get("id") or form.get("sessionId", "")
    status = _map_provider_status(form.get("status", ""))
    applied = alerts_repo.handle_status(conn, provider_id, status) if status else False
    return WebhookResult(ok=True, applied=applied)


_PROVIDER_STATUS = {
    "Success": "delivered",
    "Completed": "delivered",
    "Sent": "sent",
    "Failed": "failed",
    "Aborted": "failed",
}


def _map_provider_status(raw: str) -> str | None:
    return _PROVIDER_STATUS.get(raw)


async def _params(request: Request) -> dict[str, str]:
    """Accept both form-encoded (Africa's Talking) and JSON bodies."""
    ctype = request.headers.get("content-type", "")
    if "application/json" in ctype:
        data = await request.json()
        return {k: str(v) for k, v in data.items()}
    form = await request.form()
    return {k: str(v) for k, v in form.items()}


@app.get("/events")
async def events() -> Any:
    return event_source()


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run("dira_api.main:app", host=settings.api_host, port=settings.api_port, reload=True)


if __name__ == "__main__":
    run()
