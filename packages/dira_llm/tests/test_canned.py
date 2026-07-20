from __future__ import annotations

from datetime import date

from dira_llm.canned import CannedResponseAdapter
from dira_llm.prompts import ALERT_DRAFT_SYSTEM
from dira_llm.signals import SignalExtractionResponse, extract_signals

FORBIDDEN_ALERT_TERMS = [
    "al-shabaab",
    "garre",
    "degodia",
    "clan",
    "militia",
    "kenya defence",
    "ethiopian regional",
    "somali border",
]


def test_canned_signal_json_matches_schema() -> None:
    payload = CannedResponseAdapter().complete_json(
        "zone_ids=['mandera_ke_north'] Document: Dry wells and water queues are increasing."
    )

    parsed = SignalExtractionResponse.model_validate(payload)

    assert parsed.signals[0].zone_id == "mandera_ke_north"
    assert 0.0 <= parsed.signals[0].confidence <= 1.0


def test_canned_alert_copy_is_do_no_harm() -> None:
    payload = CannedResponseAdapter().complete_json(
        "Draft alert for high risk in Mandera", system=ALERT_DRAFT_SYSTEM
    )
    body = payload["body_text"].lower()

    assert "body_text" in payload
    assert not any(term in body for term in FORBIDDEN_ALERT_TERMS)


def test_extract_signals_discards_invalid_after_retry() -> None:
    class BadThenGood:
        def __init__(self) -> None:
            self.calls = 0

        def complete(self, prompt: str, *, system: str | None = None) -> str:
            return "{}"

        def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, object]:
            self.calls += 1
            if self.calls == 1:
                return {"signals": [{"zone_id": "z1", "confidence": 3.0}]}
            return {
                "signals": [
                    {
                        "zone_id": "z1",
                        "signal_type": "resource_pressure",
                        "confidence": 0.7,
                        "excerpt": "water queues",
                    }
                ]
            }

    signals = extract_signals(
        [{"id": "doc-1", "title": "Water", "body": "queues"}],
        BadThenGood(),
        ["z1"],
        date(2026, 3, 11),
    )

    assert len(signals) == 1
    assert signals[0]["status"] == "unconfirmed"
