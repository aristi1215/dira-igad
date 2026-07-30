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


def test_proposal_handlers_do_not_touch_the_connection() -> None:
    class ForbiddenConnection:
        def __getattr__(self, name: str) -> object:
            raise AssertionError(f"proposal used connection: {name}")

    verify = TOOL_HANDLERS["propose_verify_field_report"](
        ForbiddenConnection(),
        {"report_id": "report-1", "reason": "Review requested"},
    )
    draft = TOOL_HANDLERS["propose_alert_draft"](
        ForbiddenConnection(),
        {"situation_id": "situation-1"},
    )
    dispatch = TOOL_HANDLERS["propose_dispatch"](
        ForbiddenConnection(),
        {
            "situation_id": "situation-1",
            "channel": "voice",
            "phone_numbers": ["+254700000001"],
        },
    )
    assert isinstance(verify, dict)
    assert isinstance(draft, dict)
    assert dispatch == {
        "type": "dispatch",
        "situation_id": "situation-1",
        "channel": "voice",
        "phone_numbers": ["+254700000001"],
        "language": "sw",
        "reason": None,
    }


def test_advisor_tool_loop_is_bounded_to_five_rounds() -> None:
    assert MAX_TOOL_ROUNDS == 5
