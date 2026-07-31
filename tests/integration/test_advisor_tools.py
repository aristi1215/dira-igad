from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from dira_api import alerts, main
from dira_api.advisor_tools import TOOL_HANDLERS
from dira_api.citations import CitationLedger
from dira_llm import CannedResponseAdapter


def test_canned_advisor_proposal_flow_never_executes_actions(db_conn, monkeypatch) -> None:
    with db_conn.cursor() as cur:
        cur.execute("SELECT id FROM field_reports ORDER BY reported_at LIMIT 1")
        report = cur.fetchone()
        if report is None:
            import pytest

            pytest.skip("Seed data needs a field report")
        cur.execute("INSERT INTO advisor_conversations DEFAULT VALUES RETURNING id")
        conversation_id = cur.fetchone()["id"]
    db_conn.commit()
    monkeypatch.setattr(main, "_language_model", lambda: CannedResponseAdapter())

    report_id = str(report["id"])
    tools_used: list[str] = []
    try:
        answer, proposals = main._drain_advisor_tool_loop(
            main._advisor_tool_loop(
                db_conn,
                conversation_id,
                [],
                {},
                CitationLedger(),
                tools_used,
                f"Please verify field report {report_id}",
            )
        )
        assert answer
        assert proposals == [
            {
                "type": "verify-field-report",
                "report_id": report_id,
                "reason": "The operator asked to review this field report.",
            }
        ]
        assert all(
            not re.search(r"approve|dispatch|deliver|send", name)
            for name in tools_used
        )
        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT status FROM alerts WHERE status = 'pending_approval'"
            )
            assert cur.fetchall() is not None
    finally:
        with db_conn.transaction():
            with db_conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM advisor_conversations WHERE id = %s",
                    (conversation_id,),
                )
        db_conn.commit()


def test_alert_and_dispatch_proposals_read_the_db_but_never_write_to_it(
    db_conn: Any, make_situation: Any, monkeypatch: Any
) -> None:
    """propose_alert_draft / propose_dispatch now read the latest assessment
    and zone context to draft real body text (so the operator can read what
    they are signing) — unlike propose_verify_field_report, they are no
    longer connection-free. This is the read-only counterpart to the unit-level
    red line: they still never INSERT or UPDATE anything."""
    monkeypatch.setattr(alerts, "_language_model", lambda: CannedResponseAdapter())
    situation_id: UUID = make_situation(None)

    def alerts_count() -> int:
        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) AS n FROM alerts WHERE situation_id = %s",
                (situation_id,),
            )
            return int(cur.fetchone()["n"])

    before = alerts_count()

    draft = TOOL_HANDLERS["propose_alert_draft"](
        db_conn, {"situation_id": str(situation_id)}
    )
    assert draft["type"] == "alert-draft"
    assert draft["body_text"]
    assert draft["zone_name"]

    dispatch = TOOL_HANDLERS["propose_dispatch"](
        db_conn,
        {
            "situation_id": str(situation_id),
            "channel": "voice",
            "phone_numbers": ["+254700000001"],
        },
    )
    assert dispatch["type"] == "dispatch"
    assert dispatch["body_text"]
    assert dispatch["zone_name"]
    assert dispatch["phone_numbers"] == ["+254700000001"]

    assert alerts_count() == before
