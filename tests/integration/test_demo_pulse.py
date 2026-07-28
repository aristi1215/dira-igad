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


def test_prepare_alert_drafts_even_when_pending_exists(monkeypatch) -> None:
    """Multiple pending alerts per situation must be allowed (demo + ops)."""
    posted: list[str] = []

    class FakeResponse:
        def __init__(self, payload):
            self.status_code = 200
            self._payload = payload

        def json(self):
            return self._payload

        def raise_for_status(self):
            return None

    class FakeClient:
        situation_id = "11111111-1111-1111-1111-111111111111"

        def get(self, url, params=None):
            if url.endswith("/map/situations"):
                return FakeResponse(
                    {
                        "features": [
                            {
                                "properties": {
                                    "zone_id": "mandera_ke_north",
                                    "situation_id": self.situation_id,
                                }
                            }
                        ]
                    }
                )
            raise AssertionError(f"unexpected GET {url}")

        def post(self, url, json=None, **kwargs):
            posted.append(url)
            return FakeResponse({"id": "new-alert", "status": "pending_approval"})

    demo_pulse._step_prepare_alert(FakeClient(), {"zone_id": "mandera_ke_north"})
    assert posted == [
        f"{demo_pulse.API}/situations/{FakeClient.situation_id}/alert"
    ]
