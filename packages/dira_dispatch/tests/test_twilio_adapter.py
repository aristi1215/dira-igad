"""Unit tests for the Twilio voice adapter (no network)."""

from __future__ import annotations

import pytest
from dira_dispatch import TwilioVoiceAdapter


def _adapter() -> TwilioVoiceAdapter:
    return TwilioVoiceAdapter(
        account_sid="ACtest",
        auth_token="token",
        from_number="+15550001111",
        public_base_url="https://example.org",
    )


@pytest.fixture()
def no_twilio_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in (
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "TWILIO_API_KEY_SID",
        "TWILIO_API_KEY_SECRET",
        "TWILIO_FROM_NUMBER",
    ):
        monkeypatch.delenv(var, raising=False)


def test_requires_credentials(no_twilio_env: None) -> None:
    with pytest.raises(RuntimeError):
        TwilioVoiceAdapter(account_sid=None, from_number="+15550001111")


def test_requires_from_number(no_twilio_env: None) -> None:
    with pytest.raises(RuntimeError):
        TwilioVoiceAdapter(account_sid="ACtest", auth_token="t", from_number=None)


def test_twiml_uses_play_for_http_audio() -> None:
    twiml = _adapter().twiml("https://example.org/audio/alert.mp3")
    assert "<Play>https://example.org/audio/alert.mp3</Play>" in twiml
    assert "<Gather" in twiml
    assert "/webhooks/twilio/gather" in twiml


def test_twiml_falls_back_to_say_for_local_audio() -> None:
    twiml = _adapter().twiml("file:///tmp/alert.mp3")
    assert "<Play>" not in twiml
    assert "<Say" in twiml


def test_twiml_escapes_xml() -> None:
    twiml = _adapter().twiml("https://example.org/a.mp3?x=1&y=2")
    assert "&amp;" in twiml
    assert "&y=2" not in twiml
