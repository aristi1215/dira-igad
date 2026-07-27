"""Demo pulse red lines: seeded-only, no approval bypass, valid scenario data."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from dira_api.context_routes import FIELD_REPORT_CATEGORIES

_spec = importlib.util.spec_from_file_location(
    "demo_pulse", Path(__file__).resolve().parents[2] / "scripts" / "demo_pulse.py"
)
assert _spec and _spec.loader
demo_pulse = importlib.util.module_from_spec(_spec)
sys.modules["demo_pulse"] = demo_pulse
_spec.loader.exec_module(demo_pulse)


def test_scenario_never_approves_or_dispatches() -> None:
    kinds = {step["kind"] for step in demo_pulse.SCENARIO}
    assert kinds <= {"report", "verify", "dismiss", "prepare_alert"}
    for step in demo_pulse.SCENARIO:
        assert "approve" not in step.get("kind", "")


def test_scenario_reports_use_valid_categories() -> None:
    for step in demo_pulse.SCENARIO:
        if step["kind"] == "report":
            assert step["category"] in FIELD_REPORT_CATEGORIES
            assert 1 <= step["severity"] <= 3
    for category in demo_pulse.HEARTBEAT_CATEGORIES:
        assert category in FIELD_REPORT_CATEGORIES


def test_refuses_to_run_outside_seeded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATA_MODE", "live")
    with pytest.raises(SystemExit):
        demo_pulse._require_seeded(client=None)  # type: ignore[arg-type]


def test_scenario_is_mandera_first() -> None:
    first_report = next(s for s in demo_pulse.SCENARIO if s["kind"] == "report")
    assert first_report["zone_id"].startswith("mandera_")
