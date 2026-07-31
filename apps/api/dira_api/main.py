"""FastAPI application — routes, webhooks, SSE."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from dira_core.alerts import AlertVariant, derive_idempotency_key, resolve_alert_body
from dira_core.ports import ToolCallingLanguageModel
from dira_data.db import connect
from dira_data.economy import get_economy_source
from dira_data.retrieval import search_corpus
from dira_dispatch import build_voice_twiml
from dira_llm import get_embedding_model
from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from dira_api.advisor_tools import TOOL_HANDLERS, TOOL_SPECS
from dira_api.alerts import _draft_alert_text, _language_model, _latest_alert_assessment
from dira_api.citations import CitationLedger
from dira_api.context_routes import router as context_router
from dira_api.settings import Settings, get_settings

logger = logging.getLogger("dira.api")
MAX_TOOL_ROUNDS = 5

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


# A fan-out this large is a configuration mistake, not an intent. The cap is a
# guard against a malformed client, not a policy on how many people may be warned.
MAX_SELECTED_RECIPIENTS = 500


class ApproveBody(BaseModel):
    approved_by: str = Field(min_length=1)
    # None keeps the historical behaviour — every active recipient matching the
    # alert's zone. A list is an explicit operator choice and is used verbatim.
    recipient_ids: list[UUID] | None = None


class RejectBody(BaseModel):
    rejected_by: str = Field(min_length=1, max_length=200)
    reason: str | None = Field(default=None, max_length=2000)


class VariantCreateBody(BaseModel):
    language: str = Field(pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$", max_length=12)
    role: str | None = Field(default=None, max_length=64)
    #: Omit to have the language model draft it; supply to hand-write it.
    body_text: str | None = Field(default=None, min_length=1, max_length=4000)


class VariantEditBody(BaseModel):
    body_text: str = Field(min_length=1, max_length=4000)


class AlertDraftBody(BaseModel):
    created_by: str = "advisor"
    language: str = "sw"
    # Supplied when the operator writes the alert themselves. Drafting is the
    # default, not the only way in: asking the LLM for words that are about to
    # be thrown away costs a round trip and, in live mode, money.
    body_text: str | None = Field(default=None, min_length=1, max_length=4000)


class AlertEditBody(BaseModel):
    body_text: str | None = Field(default=None, min_length=1, max_length=4000)
    language: str | None = Field(
        default=None, pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$", max_length=12
    )


class RecipientCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    zone_id: str | None = None
    phone_e164: str = Field(pattern=r"^\+[1-9][0-9]{7,14}$")
    language: str = Field(default="sw", pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$", max_length=12)
    channel: Literal["voice", "sms", "both"] = "voice"


class RecipientPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone_e164: str | None = Field(default=None, pattern=r"^\+[1-9][0-9]{7,14}$")
    language: str | None = Field(
        default=None, pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$", max_length=12
    )
    channel: Literal["voice", "sms", "both"] | None = None
    active: bool | None = None


class AdvisorDispatchBody(BaseModel):
    situation_id: UUID
    phone_numbers: list[str]
    channel: Literal["voice", "sms", "both"] = "voice"
    language: str = Field(
        default="sw", pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$", max_length=12
    )
    body_text: str | None = Field(default=None, min_length=1, max_length=4000)
    approved_by: str = Field(min_length=1, max_length=200)


class RetryBody(BaseModel):
    pass


class AdvisorBody(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    situation_id: UUID | None = None
    zone_id: str | None = None
    conversation_id: UUID | None = None


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


AUDIO_DIR = Path(__file__).resolve().parents[3] / "artifacts" / "audio"
E164_PATTERN = re.compile(r"^\+[1-9][0-9]{7,14}$")


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
        if body.body_text is None:
            text, latest, _zone_name = _draft_alert_text(conn, situation_id, body.language)
        else:
            # Still read the assessment: the forecast window belongs to the
            # situation, not to whoever typed the words.
            _sit, latest_row = _latest_alert_assessment(conn, situation_id)
            conn.commit()
            text = body.body_text
            latest = latest_row or {}
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
                        latest.get("window_start"),
                        latest.get("window_end"),
                    ),
                )
                row = cur.fetchone()
    return _jsonable(dict(row))


@app.patch("/alerts/{alert_id}")
def edit_alert(alert_id: UUID, body: AlertEditBody) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    if body.body_text is not None:
        updates["body_text"] = body.body_text
    if body.language is not None:
        updates["language"] = body.language
    if not updates:
        raise HTTPException(422, "At least one alert field is required")

    assignments = ", ".join(f"{key} = %s" for key in updates)
    values = [*updates.values(), alert_id]
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE alerts
                    SET {assignments}, updated_at = now()
                    WHERE id = %s AND status = 'pending_approval'
                    RETURNING id, situation_id, status, language, body_text,
                              created_by, approved_by, approved_at, created_at,
                              updated_at, window_start, window_end
                    """,
                    values,
                )
                row = cur.fetchone()
                if row is None:
                    cur.execute("SELECT id, status FROM alerts WHERE id = %s", (alert_id,))
                    existing = cur.fetchone()
                    if existing is None:
                        raise HTTPException(404, "Alert not found")
                    raise HTTPException(409, f"Alert status is {existing['status']}")
    return _jsonable(dict(row))


@app.post("/recipients")
def create_recipient(body: RecipientCreateBody) -> dict[str, Any]:
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO recipients (name, zone_id, phone_e164, language, channel)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id, name, phone_e164, zone_id, language, channel, active
                    """,
                    (body.name, body.zone_id, body.phone_e164, body.language, body.channel),
                )
                row = cur.fetchone()
    return _jsonable(dict(row))


@app.patch("/recipients/{recipient_id}")
def edit_recipient(recipient_id: UUID, body: RecipientPatchBody) -> dict[str, Any]:
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(422, "At least one recipient field is required")
    assignments = ", ".join(f"{key} = %s" for key in updates)
    values = [*updates.values(), recipient_id]
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE recipients
                    SET {assignments}
                    WHERE id = %s
                    RETURNING id, name, phone_e164, zone_id, language, channel, active
                    """,
                    values,
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(404, "Recipient not found")
    return _jsonable(dict(row))


@app.delete("/recipients/{recipient_id}")
def delete_recipient(recipient_id: UUID) -> dict[str, Any]:
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE recipients SET active = FALSE
                    WHERE id = %s
                    RETURNING id, name, phone_e164, zone_id, language, channel, active
                    """,
                    (recipient_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(404, "Recipient not found")
    return _jsonable(dict(row))


@app.post("/advisor/dispatch")
def advisor_dispatch(body: AdvisorDispatchBody) -> dict[str, Any]:
    signer = body.approved_by.strip()
    if not signer:
        raise HTTPException(400, "approved_by required")
    if not body.phone_numbers:
        raise HTTPException(400, "phone_numbers must contain at least one number")
    if len(body.phone_numbers) > 10:
        raise HTTPException(400, "phone_numbers cannot contain more than 10 numbers")

    invalid = [number for number in body.phone_numbers if not E164_PATTERN.fullmatch(number)]
    if invalid:
        raise HTTPException(
            400,
            f"Invalid E.164 phone number(s): {', '.join(invalid)}",
        )
    phone_numbers = list(dict.fromkeys(body.phone_numbers))

    with connect(_settings().database_url) as conn:
        if body.body_text is None:
            text, latest, _zone_name = _draft_alert_text(conn, body.situation_id, body.language)
        else:
            _, latest_row = _latest_alert_assessment(conn, body.situation_id)
            conn.commit()
            text = body.body_text
            latest = latest_row or {}

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT zone_id FROM situations WHERE id = %s",
                    (body.situation_id,),
                )
                situation = cur.fetchone()
                if situation is None:
                    raise HTTPException(404, "Situation not found")

                cur.execute(
                    """
                    INSERT INTO alerts (
                      situation_id, status, language, body_text, created_by,
                      approved_by, approved_at, window_start, window_end
                    )
                    VALUES (%s, 'approved', %s, %s, 'advisor', %s, now(), %s, %s)
                    RETURNING id
                    """,
                    (
                        body.situation_id,
                        body.language,
                        text,
                        signer,
                        latest.get("window_start"),
                        latest.get("window_end"),
                    ),
                )
                alert_id = cur.fetchone()["id"]
                deliveries = 0
                channels = (
                    ("voice", "sms")
                    if body.channel == "both"
                    else (body.channel,)
                )
                for phone_number in phone_numbers:
                    cur.execute(
                        """
                        INSERT INTO recipients (
                          name, zone_id, phone_e164, language, channel, active
                        )
                        VALUES (%s, %s, %s, %s, %s, FALSE)
                        RETURNING id
                        """,
                        (
                            f"Direct dispatch · {phone_number}",
                            situation["zone_id"],
                            phone_number,
                            body.language,
                            body.channel,
                        ),
                    )
                    recipient_id = cur.fetchone()["id"]
                    for channel in channels:
                        idem = derive_idempotency_key(
                            str(alert_id), str(recipient_id), channel
                        )
                        cur.execute(
                            """
                            INSERT INTO deliveries (
                              alert_id, recipient_id, channel, idempotency_key,
                              status, body_text
                            )
                            VALUES (%s, %s, %s, %s, 'queued', %s)
                            ON CONFLICT (idempotency_key) DO NOTHING
                            RETURNING id
                            """,
                            (alert_id, recipient_id, channel, idem, text),
                        )
                        if cur.fetchone() is not None:
                            deliveries += 1

    return {
        "alert_id": str(alert_id),
        "status": "approved",
        "approved_by": signer,
        "channel": body.channel,
        "phone_numbers": phone_numbers,
        "deliveries": deliveries,
    }


DEFAULT_RECIPIENTS_SQL = """
    SELECT DISTINCT ON (r.phone_e164)
           r.id, r.name, r.phone_e164, r.channel, r.language, r.role,
           r.zone_id, z.name AS zone_name,
           CASE WHEN r.zone_id IS NULL THEN 'all zones' ELSE 'zone match' END
             AS match_reason
    FROM recipients r
    LEFT JOIN zones z ON z.id = r.zone_id
    WHERE r.active = TRUE AND (r.zone_id = %s OR r.zone_id IS NULL)
    ORDER BY r.phone_e164,
             (r.zone_id IS NULL),           -- zone-specific beats all-zones
             (r.channel = 'both') DESC,     -- never silently drop a channel
             r.created_at DESC              -- a re-registration is current intent
"""


def _default_recipients(cur: Any, zone_id: str) -> list[dict[str, Any]]:
    """Who an alert for this zone reaches if the operator changes nothing.

    This rule lives here and only here. It used to exist twice — once in SQL at
    approval time and once in TypeScript on the dispatch screen — which meant
    the set the operator saw and the set that got called could drift apart.
    """
    cur.execute(DEFAULT_RECIPIENTS_SQL, (zone_id,))
    return [dict(row) for row in cur.fetchall()]


def _selected_recipients(cur: Any, recipient_ids: list[UUID]) -> list[dict[str, Any]]:
    """Resolve an explicit operator selection, refusing anything unusable.

    Deliberately *not* restricted to the alert's zone: pulling in a contact from
    a neighbouring zone is a main reason this parameter exists.
    """
    if not recipient_ids:
        raise HTTPException(
            422,
            "recipient_ids is empty — approving would queue nothing. "
            "Reject the alert instead if it should not go out.",
        )
    if len(recipient_ids) > MAX_SELECTED_RECIPIENTS:
        raise HTTPException(
            422, f"recipient_ids cannot exceed {MAX_SELECTED_RECIPIENTS} entries"
        )

    unique_ids = list(dict.fromkeys(recipient_ids))
    cur.execute(
        """
        SELECT r.id, r.name, r.phone_e164, r.channel, r.language, r.role,
               r.active, r.zone_id, z.name AS zone_name
        FROM recipients r
        LEFT JOIN zones z ON z.id = r.zone_id
        WHERE r.id = ANY(%s)
        ORDER BY (r.channel = 'both') DESC, r.created_at DESC
        """,
        (unique_ids,),
    )
    rows = [dict(row) for row in cur.fetchall()]

    found = {row["id"] for row in rows}
    unknown = [str(rid) for rid in unique_ids if rid not in found]
    if unknown:
        raise HTTPException(422, f"Unknown recipient(s): {', '.join(unknown)}")

    inactive = [row["name"] for row in rows if not row["active"]]
    if inactive:
        raise HTTPException(
            422,
            f"Inactive recipient(s) cannot be dispatched to: {', '.join(inactive)}",
        )

    # Same phone means same person, whichever roster rows they occupy. The
    # query ordered 'both' first, so the widest channel survives.
    by_phone: dict[str, dict[str, Any]] = {}
    for row in rows:
        by_phone.setdefault(row["phone_e164"], row)
    return list(by_phone.values())


def _alert_variants(cur: Any, alert_id: UUID) -> list[AlertVariant]:
    cur.execute(
        "SELECT language, role, body_text FROM alert_variants WHERE alert_id = %s",
        (alert_id,),
    )
    return [
        AlertVariant(
            language=row["language"], role=row["role"], body_text=row["body_text"]
        )
        for row in cur.fetchall()
    ]


def _queue_deliveries(
    cur: Any,
    alert_id: UUID,
    recipients: list[dict[str, Any]],
    *,
    alert_language: str,
    alert_body_text: str,
    variants: list[AlertVariant],
) -> int:
    """Insert one delivery per recipient×channel. Returns the expected count.

    The resolved wording is frozen onto each delivery here, at approval, not at
    dispatch: the approver is accountable for the exact string each person
    receives, and a later edit must not be able to change it underneath them.
    """
    expected = 0
    for rec in recipients:
        resolved = resolve_alert_body(
            variants,
            recipient_language=rec.get("language"),
            recipient_role=rec.get("role"),
            alert_language=alert_language,
            alert_body_text=alert_body_text,
        )
        channels = ("voice", "sms") if rec["channel"] == "both" else (rec["channel"],)
        expected += len(channels)
        for channel in channels:
            idem = derive_idempotency_key(str(alert_id), str(rec["id"]), channel)
            cur.execute(
                """
                INSERT INTO deliveries (
                  alert_id, recipient_id, channel, idempotency_key, status, body_text
                ) VALUES (%s, %s, %s, %s, 'queued', %s)
                ON CONFLICT (idempotency_key) DO NOTHING
                """,
                (alert_id, rec["id"], channel, idem, resolved.body_text),
            )
    return expected


@app.get("/alerts/{alert_id}/recipients")
def alert_recipients(alert_id: UUID) -> list[dict[str, Any]]:
    """The default target set for this alert, annotated with why each matched
    and which wording they would hear.

    Both rules — who is targeted, and which variant they get — are answered here
    so the dispatch screen never has to reimplement either one.
    """
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.language, a.body_text, s.zone_id
                FROM alerts a JOIN situations s ON s.id = a.situation_id
                WHERE a.id = %s
                """,
                (alert_id,),
            )
            alert = cur.fetchone()
            if alert is None:
                raise HTTPException(404, "Alert not found")

            variants = _alert_variants(cur, alert_id)
            rows = _default_recipients(cur, alert["zone_id"])
            for row in rows:
                resolved = resolve_alert_body(
                    variants,
                    recipient_language=row.get("language"),
                    recipient_role=row.get("role"),
                    alert_language=str(alert["language"]),
                    alert_body_text=str(alert["body_text"]),
                )
                row["variant_language"] = resolved.language
                row["variant_match"] = resolved.matched
                row["variant_is_fallback"] = resolved.is_fallback
            return [_jsonable(row) for row in rows]


@app.get("/alerts/{alert_id}/variants")
def list_alert_variants(alert_id: UUID) -> list[dict[str, Any]]:
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, alert_id, language, role, body_text, source, llm_draft,
                       created_at, updated_at
                FROM alert_variants
                WHERE alert_id = %s
                ORDER BY language, role NULLS FIRST
                """,
                (alert_id,),
            )
            return [_jsonable(dict(row)) for row in cur.fetchall()]


@app.post("/alerts/{alert_id}/variants")
def create_alert_variant(alert_id: UUID, body: VariantCreateBody) -> dict[str, Any]:
    """Draft (or hand-write) one wording of an alert."""
    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT situation_id, status FROM alerts WHERE id = %s", (alert_id,))
            alert = cur.fetchone()
        if alert is None:
            conn.commit()
            raise HTTPException(404, "Alert not found")
        if alert["status"] != "pending_approval":
            conn.commit()
            raise HTTPException(409, f"Alert status is {alert['status']}")

        if body.body_text is None:
            text, _latest, _zone = _draft_alert_text(
                conn, alert["situation_id"], body.language
            )
            source = "llm"
            llm_draft: str | None = text
        else:
            conn.commit()
            text = body.body_text
            source = "human_authored"
            llm_draft = None

        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO alert_variants (
                      alert_id, language, role, body_text, source, llm_draft
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (alert_id, language, COALESCE(role, ''))
                    DO UPDATE SET body_text = EXCLUDED.body_text,
                                  source = EXCLUDED.source,
                                  llm_draft = EXCLUDED.llm_draft,
                                  updated_at = now()
                    RETURNING id, alert_id, language, role, body_text, source,
                              llm_draft, created_at, updated_at
                    """,
                    (alert_id, body.language, body.role, text, source, llm_draft),
                )
                row = cur.fetchone()
    return _jsonable(dict(row))


@app.patch("/alert-variants/{variant_id}")
def edit_alert_variant(variant_id: UUID, body: VariantEditBody) -> dict[str, Any]:
    """Edit a variant by hand, preserving what the model originally wrote.

    `llm_draft` is filled on the *first* edit only. Overwriting it on every save
    would lose the AI draft after two keystrokes, and the drafted-versus-sent
    diff is the whole point of keeping it.
    """
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE alert_variants
                    SET body_text = %s,
                        llm_draft = COALESCE(llm_draft, body_text),
                        source = 'human_edited',
                        updated_at = now()
                    WHERE id = %s
                    RETURNING id, alert_id, language, role, body_text, source,
                              llm_draft, created_at, updated_at
                    """,
                    (body.body_text, variant_id),
                )
                row = cur.fetchone()
                if row is None:
                    raise HTTPException(404, "Variant not found")
    return _jsonable(dict(row))


@app.delete("/alert-variants/{variant_id}")
def delete_alert_variant(variant_id: UUID) -> dict[str, str]:
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM alert_variants WHERE id = %s RETURNING id",
                    (variant_id,),
                )
                if cur.fetchone() is None:
                    raise HTTPException(404, "Variant not found")
    return {"id": str(variant_id), "status": "deleted"}


@app.post("/alerts/{alert_id}/reject")
def reject_alert(alert_id: UUID, body: RejectBody) -> dict[str, Any]:
    """Decline a drafted alert on the record. Queues nothing, ever."""
    with connect(_settings().database_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE alerts
                    SET status = 'rejected',
                        rejected_by = %s,
                        rejected_at = now(),
                        rejection_reason = %s,
                        updated_at = now()
                    WHERE id = %s AND status = 'pending_approval'
                    RETURNING id, status, rejected_by, rejected_at, rejection_reason
                    """,
                    (body.rejected_by.strip(), body.reason, alert_id),
                )
                row = cur.fetchone()
                if row is None:
                    cur.execute("SELECT status FROM alerts WHERE id = %s", (alert_id,))
                    existing = cur.fetchone()
                    if existing is None:
                        raise HTTPException(404, "Alert not found")
                    raise HTTPException(409, f"Alert status is {existing['status']}")
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
                        SELECT a.id, a.status, a.situation_id, a.body_text,
                               a.language, s.zone_id
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

                    # Resolved before the UPDATE so a bad selection fails the
                    # request without ever flipping the alert to approved.
                    recipients = (
                        _default_recipients(cur, alert["zone_id"])
                        if body.recipient_ids is None
                        else _selected_recipients(cur, body.recipient_ids)
                    )

                    now = datetime.now(UTC)
                    body_sha = hashlib.sha256(
                        str(alert["body_text"]).encode("utf-8")
                    ).hexdigest()
                    cur.execute(
                        """
                        UPDATE alerts
                        SET status = 'approved',
                            approved_by = %s,
                            approved_at = %s,
                            approved_body_sha256 = %s,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        (signer, now, body_sha, alert_id),
                    )

                    expected_delivery_count = _queue_deliveries(
                        cur,
                        alert_id,
                        recipients,
                        alert_language=str(alert["language"]),
                        alert_body_text=str(alert["body_text"]),
                        variants=_alert_variants(cur, alert_id),
                    )
                    cur.execute(
                        "SELECT count(*) AS count FROM deliveries WHERE alert_id = %s",
                        (alert_id,),
                    )
                    delivery_count = int(cur.fetchone()["count"])
                    if delivery_count != expected_delivery_count:
                        raise RuntimeError(
                            "Approval did not queue deliveries for every selected recipient"
                        )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Approve failed")
            raise HTTPException(500, str(exc)) from exc

    return {
        "id": str(alert_id),
        "status": "approved",
        "approved_by": signer,
        "recipients": len(recipients),
        "deliveries": expected_delivery_count,
    }


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
                       ns.excerpt, ns.cycle, ns.created_at, nd.title, nd.source,
                       nd.published_at, nd.available_at, nd.external_id, nd.url,
                       left(nd.body, 700) AS body_excerpt
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
    "in the IGAD region. You receive a standing regional briefing covering all 22 "
    "zones plus deeper context for whatever the operator has selected. Reach for "
    "your read tools whenever a question is comparative, regional, or needs more "
    "than the standing briefing carries: read_neighbours and compare_zones for "
    "cross-zone and regional questions, read_zone_profile for depth on one zone "
    "(prices, incidents, climate), read_trends for what changed, "
    "read_regional_overview for region-wide analytics, read_economy for macro "
    "indicators, and search_corpus for grounded passages. If a zone is calm but "
    "its neighbours are not, say so plainly, using read_neighbours rather than "
    "describing only the selected zone. Give practical, do-no-harm preparedness "
    "guidance. Never name actors, ethnicities, clans, or communities. Keep answers "
    "under 180 words normally, up to 320 words for comparative or regional "
    "answers.\n\n"
    "Citations: every row or passage you are given carries a 'cite' field like "
    "'S3'. When a claim in your answer rests on one, write the marker inline as "
    "[S3] immediately after the claim. Cite sparingly — only load-bearing claims "
    "— and never append your own list of sources; the interface renders the "
    "cited ones for you.\n\n"
    "You have safe, operator-gated proposal tools: propose_verify_field_report, "
    "propose_alert_draft, and propose_dispatch. When the operator asks you to alert, "
    "call, text, message, or dispatch to one or more phone numbers, DO call "
    "propose_dispatch with the situation_id, the chosen channel (voice, sms, or both), "
    "and the phone_numbers they gave (E.164, e.g. +254712345678) — this only prepares a "
    "proposal, with drafted body text the operator can read and edit, for them to "
    "review and confirm. You never approve, dispatch, call, or send anything "
    "yourself; a named human must confirm in the panel. Prefer preparing a "
    "proposal over declining when an action is requested, then briefly explain "
    "what you prepared and that it awaits their confirmation."
)


def _zone_briefing_line(row: dict[str, Any]) -> str:
    """One compact line: enough for the model to reason about a zone it was not
    asked about, with `sit=<uuid>` at the end so propose_alert_draft and
    propose_dispatch are reachable without the operator having clicked in."""
    band = row.get("operational_band") or "none"
    risk = row.get("model_risk")
    risk_str = f"{risk:.2f}" if isinstance(risk, int | float) else "n/a"
    ipc = row.get("ipc_phase")
    idps = row.get("idps")
    if isinstance(idps, int | float):
        idps_str = f"{idps / 1000:.0f}k" if idps >= 1000 else str(int(idps))
    else:
        idps_str = "n/a"
    staple = row.get("staple_pct_vs_3m_avg")
    staple_str = f"{staple:+.0f}%" if isinstance(staple, int | float) else "n/a"
    line = (
        f"{row['zone_id']} | {row['zone_name']} | {row['country_iso2']} | "
        f"{row.get('cluster_name') or 'n/a'} | band={band} risk={risk_str} | "
        f"IPC {ipc if ipc is not None else 'n/a'} | idps {idps_str} | "
        f"hazards {row.get('active_hazards') or 0} | "
        f"health flags {row.get('active_health_alerts') or 0} | "
        f"staple {staple_str}"
    )
    if row.get("situation_id"):
        line += f" | sit={row['situation_id']}"
    return line


def _regional_briefing(conn: Any, settings: Settings) -> str:
    """All 22 zones, one line each, at ~600 tokens total — reused verbatim from
    context_routes.list_zones() rather than duplicating its SQL."""
    from dira_api.context_routes import list_zones

    with conn.cursor() as cur:
        cur.execute("SELECT max(cycle) AS cycle FROM assessments")
        cycle_row = cur.fetchone()
    cycle = cycle_row["cycle"].isoformat() if cycle_row and cycle_row["cycle"] else "n/a"
    lines = [_zone_briefing_line(_jsonable(row)) for row in list_zones()]
    return f"data_mode={settings.data_mode} current_cycle={cycle}\n" + "\n".join(lines)


def _advisor_gather(
    conn: Any, body: AdvisorBody
) -> tuple[dict[str, Any], CitationLedger, list[str]]:
    """Standing regional briefing plus read-only queries scoped to the selected
    zone/situation. Returns (context, ledger, tools_used). Never mutates state."""
    context: dict[str, Any] = {}
    ledger = CitationLedger()
    tools: list[str] = ["regional_briefing"]
    zone_id = body.zone_id
    # Embed before opening the read cursor: live adapters may make an external
    # request, and no external network call belongs inside a DB transaction.
    query_embedding = get_embedding_model().embed([body.question])[0]
    context["regional_briefing"] = _regional_briefing(conn, _settings())
    with conn.cursor() as cur:
        if body.situation_id:
            tools.append("read_situation")
            context["situation_id"] = str(body.situation_id)
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
                situation_row = _jsonable(dict(row))
                ledger.attach(
                    [situation_row], kind="situation", title_key="zone_name",
                    href=f"/situations/{body.situation_id}",
                )
                context["situation"] = situation_row
                zone_id = zone_id or str(row["zone_id"])
        if zone_id:
            tools.append("read_zone_context")
            cur.execute(
                "SELECT * FROM v_zone_context WHERE zone_id = %s",
                (zone_id,),
            )
            zc = cur.fetchone()
            if zc:
                zone_row = _jsonable(dict(zc))
                ledger.attach(
                    [zone_row], kind="zone_dossier", title_key="zone_name",
                    href=f"/zones/{zone_id}",
                )
                context["zone_context"] = zone_row
            tools.append("query_news_signals")
            cur.execute(
                """
                SELECT ns.signal_type, ns.excerpt, ns.status, nd.title, nd.source,
                       nd.published_at, nd.url
                FROM news_signals ns
                LEFT JOIN news_documents nd ON nd.id = ns.document_id
                WHERE ns.zone_id = %s
                  AND nd.available_at <= now()
                ORDER BY ns.cycle DESC LIMIT 5
                """,
                (zone_id,),
            )
            signals = [_jsonable(dict(r)) for r in cur.fetchall()]
            ledger.attach(
                signals, kind="news", title_key="title", source_key="source",
                url_key="url",
            )
            context["news_signals"] = signals
            tools.append("query_hazards")
            cur.execute(
                """
                SELECT hazard_type, severity, headline, source, url, valid_from
                FROM hazard_bulletins
                WHERE zone_id = %s AND available_at <= now()
                ORDER BY valid_from DESC LIMIT 5
                """,
                (zone_id,),
            )
            hazards = [_jsonable(dict(r)) for r in cur.fetchall()]
            ledger.attach(
                hazards, kind="hazard", title_key="headline", source_key="source",
                url_key="url",
            )
            context["hazard_bulletins"] = hazards
            tools.append("query_field_reports")
            cur.execute(
                """
                SELECT reporter_role, category, severity, status, reported_at
                FROM field_reports
                WHERE zone_id = %s AND available_at <= now()
                ORDER BY reported_at DESC LIMIT 5
                """,
                (zone_id,),
            )
            reports = [_jsonable(dict(r)) for r in cur.fetchall()]
            ledger.attach(
                reports, kind="field_report", title_key="category",
                source_key="reporter_role", href=f"/zones/{zone_id}",
            )
            context["field_reports"] = reports
    tools.append("search_corpus")
    corpus_hits = [
        _jsonable(hit)
        for hit in search_corpus(
            conn, query_embedding, cutoff=datetime.now(UTC), zone_id=zone_id, limit=6
        )
    ]
    ledger.attach_corpus(conn, corpus_hits)
    context["retrieval_chunks"] = corpus_hits
    return context, ledger, tools


def _advisor_open_turn(conn: Any, body: AdvisorBody) -> tuple[Any, list[dict[str, Any]]]:
    """Resolve (or create) the conversation, read its history, record the question.

    Returns (conversation_id, prior history oldest-first).
    """
    with conn.transaction():
        with conn.cursor() as cur:
            conversation_id = None
            if body.conversation_id:
                cur.execute(
                    "SELECT id FROM advisor_conversations WHERE id = %s",
                    (body.conversation_id,),
                )
                if cur.fetchone():
                    conversation_id = body.conversation_id
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
    return conversation_id, history


def _advisor_prompt(
    history: list[dict[str, Any]],
    context: dict[str, Any],
    tools: list[str],
    question: str,
) -> str:
    history_text = "\n".join(f"{m['role']}: {m['content']}" for m in history)
    briefing = context.get("regional_briefing", "")
    rest = {k: v for k, v in context.items() if k != "regional_briefing"}
    return (
        f"Regional briefing (all 22 zones, standing context):\n{briefing}\n\n"
        f"Conversation so far:\n{history_text}\n\n"
        f"Retrieved context (tools: {', '.join(tools)}): {rest}\n\n"
        f"Question: {question}"
    )


def _advisor_fallback(context: dict[str, Any]) -> str:
    """Deterministic answer for when no language model is reachable.

    The advisor degrades to something still operationally useful rather than an
    error, matching how the pipeline degrades elsewhere.
    """
    band = (
        context.get("situation", {}).get("operational_band")
        if isinstance(context.get("situation"), dict)
        else None
    ) or "elevated"
    return (
        f"Advisor offline fallback: current operational band is {band}. "
        "Recommended: verify water-point functionality, brief peace committees, "
        "pre-position mediation teams along grazing corridors, and confirm alert "
        "recipients are reachable. Re-ask when the language model is available."
    )


def _advisor_persist(
    conn: Any, conversation_id: Any, answer: str, citations: list[dict[str, Any]]
) -> None:
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


def _advisor_persist_tool_message(
    conn: Any,
    conversation_id: Any,
    *,
    role: str,
    content: str,
    tool_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO advisor_messages (
                  conversation_id, role, content, tool_name, citations
                ) VALUES (%s, %s, %s, %s, %s::jsonb)
                """,
                (
                    conversation_id,
                    role,
                    content,
                    tool_name,
                    json.dumps(metadata or {}, default=str),
                ),
            )


def _advisor_tool_loop(
    conn: Any,
    conversation_id: Any,
    history: list[dict[str, Any]],
    context: dict[str, Any],
    ledger: CitationLedger,
    tools: list[str],
    question: str,
) -> Any:
    """Run at most five model/tool rounds, with proposal results kept inert.

    A generator, not a plain function: it yields ("tool", {...}),
    ("proposal", {...}) and ("delta", {...}) events as they really happen —
    not buffered and flushed once the model finishes — and returns
    (answer, proposals) as its `StopIteration.value` (Python generators can
    `return` a value; callers drain it with `next()`/`for` and catch that).
    `/advisor` drains it silently; `/advisor/stream` forwards each event as
    an SSE frame.
    """
    llm = _language_model()
    prompt = _advisor_prompt(history, context, tools, question)
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    proposals: list[dict[str, Any]] = []
    answer = ""

    if not isinstance(llm, ToolCallingLanguageModel):
        try:
            answer = llm.complete(prompt, system=ADVISOR_SYSTEM)
            if answer:
                yield ("delta", {"text": answer})
        except Exception:
            logger.exception("Advisor LLM failed; deterministic fallback")
        return answer or _advisor_fallback(context), proposals

    for _round in range(MAX_TOOL_ROUNDS):
        # The model and embedding adapters are called only after the preceding
        # DB read/write transaction has been closed.
        conn.commit()
        stream_with_tools = getattr(llm, "stream_with_tools", None)
        round_text = ""
        round_tool_calls: tuple[Any, ...] = ()
        try:
            if stream_with_tools is not None:
                for event_type, payload in stream_with_tools(
                    messages, TOOL_SPECS, system=ADVISOR_SYSTEM
                ):
                    if event_type == "delta":
                        round_text += payload
                        yield ("delta", {"text": payload})
                    else:
                        round_tool_calls = payload
            else:
                # Canned / Anthropic: no token-level streaming, so the whole
                # round's text arrives as a single delta rather than being
                # chunked artificially to fake a typing effect.
                turn = llm.complete_with_tools(messages, TOOL_SPECS, system=ADVISOR_SYSTEM)
                round_text = turn.text
                round_tool_calls = turn.tool_calls
                if round_text:
                    yield ("delta", {"text": round_text})
        except Exception:
            logger.exception("Advisor tool-calling round failed")
            break
        if round_text:
            answer = round_text
        if not round_tool_calls:
            break

        serialized_calls: list[dict[str, Any]] = []
        for index, call in enumerate(round_tool_calls):
            call_id = f"advisor-tool-{_round}-{index}"
            serialized_calls.append(
                {"id": call_id, "name": call.name, "arguments": call.arguments}
            )
        messages.append(
            {
                "role": "assistant",
                "content": round_text,
                "tool_calls": serialized_calls,
            }
        )
        _advisor_persist_tool_message(
            conn,
            conversation_id,
            role="assistant",
            content=round_text or "",
            tool_name=round_tool_calls[0].name,
            metadata={"tool_calls": serialized_calls},
        )

        for index, call in enumerate(round_tool_calls):
            call_id = f"advisor-tool-{_round}-{index}"
            args = dict(call.arguments)
            args["_ledger"] = ledger
            handler = TOOL_HANDLERS.get(call.name)
            if handler is None:
                result: dict[str, Any] = {"error": "Unknown advisor tool"}
            else:
                if call.name == "search_corpus":
                    conn.commit()
                    args["_query_embedding"] = get_embedding_model().embed(
                        [str(args.get("query", question))]
                    )[0]
                    args["_cutoff"] = datetime.now(UTC)
                # Immediately before dispatch, not just before the LLM call:
                # some tools (read_economy in live mode) make their own
                # network call, and no network call belongs inside an open
                # DB transaction.
                conn.commit()
                try:
                    result = handler(conn, args)
                except Exception:
                    logger.exception("Advisor tool failed: %s", call.name)
                    result = {"error": "The advisor tool could not complete."}
            conn.commit()
            tools.append(call.name)
            yield ("tool", {"name": call.name, "args": call.arguments})
            if result.get("type") in {"verify-field-report", "alert-draft", "dispatch"}:
                proposals.append(result)
                yield ("proposal", result)
            result_text = json.dumps(result, default=str)
            messages.append(
                {"role": "tool", "tool_call_id": call_id, "content": result_text}
            )
            _advisor_persist_tool_message(
                conn,
                conversation_id,
                role="tool",
                content=result_text,
                tool_name=call.name,
                metadata={"arguments": call.arguments, "result": result},
            )

    if not answer:
        answer = (
            "I reviewed the available grounded context. The suggested next step "
            "is ready for your decision."
        )
    return answer, proposals


def _drain_advisor_tool_loop(gen: Any) -> tuple[str, list[dict[str, Any]]]:
    """Consume the generator to exhaustion, discarding its events, for callers
    (the non-streaming /advisor route) that only need the final result."""
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        return stop.value  # type: ignore[return-value]


@app.post("/advisor")
def advisor(body: AdvisorBody) -> dict[str, Any]:
    """Grounded advisor: retrieval tools + multi-turn history + citations.
    Read-only — it can never approve alerts or dispatch anything."""
    with connect(_settings().database_url) as conn:
        context, ledger, tools = _advisor_gather(conn, body)
        conversation_id, history = _advisor_open_turn(conn, body)
        answer, proposals = _drain_advisor_tool_loop(
            _advisor_tool_loop(
                conn, conversation_id, history, context, ledger, tools, body.question
            )
        )

        citations = ledger.cited(answer)
        _advisor_persist(conn, conversation_id, answer, citations)

    return {
        "answer": answer,
        "context": context,
        "citations": citations,
        "tools_used": tools,
        "proposals": proposals,
        "conversation_id": str(conversation_id),
    }


@app.post("/advisor/stream")
def advisor_stream(body: AdvisorBody) -> StreamingResponse:
    """The advisor, as server-sent events.

    Every event fires when it really happens, not buffered and flushed once
    the model finishes: `tool` events fire the moment that retrieval query
    actually runs, `proposal` events the moment a proposal tool actually
    resolves, and `delta` events are genuine token deltas when the provider
    supports streaming (`OpenAIAdapter.stream_with_tools`). When it does not —
    the canned adapter the seeded demo uses, or any provider without that
    method — a round's answer arrives as a single delta rather than being
    chunked artificially to fake a typing effect.

    Read-only, exactly like `/advisor`: it can never approve or dispatch.
    """

    def event_stream() -> Any:
        def emit(event: str, payload: dict[str, Any]) -> str:
            return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"

        try:
            with connect(_settings().database_url) as conn:
                context, ledger, tools = _advisor_gather(conn, body)
                # Retrieval has already happened by this point; replaying the
                # tool list here keeps the client's trace in the true order
                # without holding the connection open across the LLM call.
                for tool in tools:
                    yield emit("tool", {"name": tool})

                conversation_id, history = _advisor_open_turn(conn, body)
                yield emit("conversation", {"conversation_id": str(conversation_id)})

                gen = _advisor_tool_loop(
                    conn, conversation_id, history, context, ledger, tools, body.question
                )
                answer, proposals = "", []
                try:
                    while True:
                        event_name, payload = next(gen)
                        yield emit(event_name, payload)
                except StopIteration as stop:
                    answer, proposals = stop.value

                citations = ledger.cited(answer)
                _advisor_persist(conn, conversation_id, answer, citations)
                yield emit(
                    "done",
                    {"citations": citations, "tools_used": tools, "proposals": proposals},
                )
        except Exception:
            logger.exception("Advisor stream aborted")
            yield emit("error", {"message": "The advisor could not answer."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        # Without this an intermediary can buffer the whole stream and deliver
        # it as one blob, which defeats the point.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
    alert_id: UUID | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    """Deliveries with the recipient attached.

    The bare row carries only `recipient_id`, which renders on the board as
    "Voice · 2 attempts" — you cannot tell who a failed call was to. The join is
    the whole point of the endpoint.
    """
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("d.status = %s")
        params.append(status)
    if alert_id is not None:
        clauses.append("d.alert_id = %s")
        params.append(alert_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with connect(_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT d.id, d.alert_id, d.recipient_id, d.channel, d.status,
                       d.ack_status, d.attempt_count, d.provider_message_id,
                       d.last_error, d.created_at, d.updated_at,
                       r.name AS recipient_name, r.phone_e164,
                       r.language AS recipient_language,
                       z.id AS zone_id, z.name AS zone_name,
                       a.language AS alert_language
                FROM deliveries d
                JOIN recipients r ON r.id = d.recipient_id
                JOIN alerts a ON a.id = d.alert_id
                LEFT JOIN zones z ON z.id = r.zone_id
                {where}
                ORDER BY d.updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (*params, limit, offset),
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


@app.api_route("/webhooks/twilio/voice", methods=["GET", "POST"])
async def webhook_voice(
    audio_url: str | None = Query(default=None),
    language: str | None = Query(default=None),
) -> Response:
    """Public TwiML for outbound calls — Twilio fetches this via the call's Url."""
    settings = _settings()
    base = settings.public_base_url.rstrip("/")
    twiml = build_voice_twiml(
        audio_url or "", f"{base}/webhooks/twilio/gather", language
    )
    return Response(content=twiml, media_type="text/xml")


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
