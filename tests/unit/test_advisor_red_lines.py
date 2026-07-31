from __future__ import annotations

import inspect
import re

from dira_api.advisor_tools import TOOL_HANDLERS, TOOL_SPECS
from dira_api.main import MAX_TOOL_ROUNDS


def test_tool_names_have_no_execution_capability_words() -> None:
    names = [spec["function"]["name"] for spec in TOOL_SPECS]
    assert all(not re.search(r"approve|deliver|send", name) for name in names)


def test_tool_handlers_contain_no_mutating_sql() -> None:
    for name, handler in TOOL_HANDLERS.items():
        source = inspect.getsource(handler).upper()
        assert "INSERT" not in source, name
        assert "UPDATE" not in source, name


def test_verify_proposal_handler_does_not_touch_the_connection() -> None:
    """Unlike propose_alert_draft / propose_dispatch (which read the latest
    assessment to draft real body text — see the integration-level red-line
    test), propose_verify_field_report needs nothing from the database."""

    class ForbiddenConnection:
        def __getattr__(self, name: str) -> object:
            raise AssertionError(f"proposal used connection: {name}")

    verify = TOOL_HANDLERS["propose_verify_field_report"](
        ForbiddenConnection(),
        {"report_id": "report-1", "reason": "Review requested"},
    )
    assert verify == {
        "type": "verify-field-report",
        "report_id": "report-1",
        "reason": "Review requested",
    }


def test_advisor_tool_loop_is_bounded_to_five_rounds() -> None:
    assert MAX_TOOL_ROUNDS == 5
