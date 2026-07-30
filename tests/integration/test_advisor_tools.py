from __future__ import annotations

import re

from dira_api import main
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
        answer, proposals = main._advisor_tool_loop(
            db_conn,
            conversation_id,
            tools_used,
            {},
            [],
            [],
            f"Please verify field report {report_id}",
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
