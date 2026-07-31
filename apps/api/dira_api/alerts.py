"""Alert drafting: turn an assessment into human-readable alert body text.

Split out of `main.py` so `advisor_tools.py` can draft real alert text for its
proposal tools without importing the FastAPI app module — `main.py` already
imports `advisor_tools.TOOL_HANDLERS`, so the reverse import would cycle.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from dira_llm import ALERT_DRAFT_SYSTEM, CannedResponseAdapter
from dira_llm.openai_adapter import OpenAIAdapter
from fastapi import HTTPException

from dira_api.settings import get_settings

logger = logging.getLogger("dira.api.alerts")


def _language_model() -> Any:
    """The advisor/alert-drafting language model.

    A single factory shared by `main.py` (the advisor conversation) and
    `advisor_tools.py` (chat-triggered alert drafts) so both read the same
    `advisor_model` setting instead of drifting apart.
    """
    from dira_llm import get_language_model

    settings = get_settings()
    if settings.openai_api_key:
        try:
            return OpenAIAdapter(
                api_key=settings.openai_api_key,
                model=settings.advisor_model,
                max_tokens=2000,
            )
        except Exception:
            logger.exception("OpenAI advisor adapter unavailable; using configured fallback")
    return get_language_model(
        openai_api_key=settings.openai_api_key,
        anthropic_api_key=settings.anthropic_api_key,
    )


def _latest_alert_assessment(
    conn: Any, situation_id: UUID | str
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.zone_id, z.name AS zone_name
            FROM situations s JOIN zones z ON z.id = s.zone_id
            WHERE s.id = %s
            """,
            (situation_id,),
        )
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
    return dict(sit), (dict(latest) if latest is not None else None)


def _draft_alert_text(
    conn: Any, situation_id: UUID | str, language: str
) -> tuple[str, dict[str, Any], str]:
    """Draft do-no-harm alert body text. Returns (body_text, latest_assessment, zone_name)."""
    sit, latest = _latest_alert_assessment(conn, situation_id)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.active_hazards, c.ipc_phase, ze.population, ze.pastoralist_share
            FROM v_zone_context c
            LEFT JOIN zone_exposure ze ON ze.zone_id = c.zone_id
            WHERE c.zone_id = %s
            """,
            (sit["zone_id"],),
        )
        zc = cur.fetchone()
    conn.commit()
    zone_name = sit["zone_name"]
    prompt = (
        f"Draft alert for {zone_name} (zone {sit['zone_id']}), "
        f"band={latest and latest['operational_band']}. "
        f"Active hazards: {zc and zc['active_hazards']}. "
        f"IPC phase: {zc and zc['ipc_phase']}. "
        f"Population: {zc and zc['population']}, "
        f"pastoralist share: {zc and zc['pastoralist_share']}. "
        f"Model explanation: {latest and latest['explanation']}. "
        f'Return JSON {{"language": "{language}", "body_text": "..."}} '
        f"with body_text in language code '{language}', under 320 characters."
    )
    try:
        draft = _language_model().complete_json(prompt, system=ALERT_DRAFT_SYSTEM)
    except Exception:
        logger.exception("LLM draft failed; using canned fallback")
        draft = CannedResponseAdapter().complete_json(prompt, system=ALERT_DRAFT_SYSTEM)
    body_text = str(draft.get("body_text") or draft.get("text") or "Tahadhari ya hali.")
    return body_text, (latest or {}), zone_name
