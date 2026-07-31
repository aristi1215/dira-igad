"""Unit tests for the Twilio voice adapter (no network)."""

from __future__ import annotations

import logging

import httpx
import pytest
from dira_dispatch import TwilioSmsAdapter, TwilioVoiceAdapter
from dira_dispatch.twilio_adapter import SAY_VOICES, say_voice


def _adapter() -> TwilioVoiceAdapter:
    return TwilioVoiceAdapter(
        account_sid="ACtest",
        auth_token="token",
        from_number="+15550001111",
        public_base_url="https://example.org",
    )


def _sms_adapter() -> TwilioSmsAdapter:
    return TwilioSmsAdapter(
        account_sid="ACtest",
        auth_token="token",
        from_number="+15550001111",
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


def test_voice_url_encodes_audio() -> None:
    voice_url = _adapter().voice_url("https://example.org/audio/a.mp3?x=1&y=2")
    assert "/webhooks/twilio/voice?audio_url=" in voice_url
    assert "%3A%2F%2F" in voice_url
    assert "://" not in voice_url.split("?", 1)[1]


def test_voice_url_carries_language() -> None:
    """Twilio fetches the TwiML from this URL, so the language has to ride along."""
    assert "language=so" in _adapter().voice_url("file:///tmp/a.mp3", "so")


@pytest.mark.parametrize("language", sorted(SAY_VOICES))
def test_say_speaks_each_supported_language(language: str) -> None:
    voice = SAY_VOICES[language]
    twiml = _adapter().twiml("file:///tmp/alert.mp3", language)
    assert f'<Say language="{voice.locale}">' in twiml
    # Both the alert text and the keypad prompt, not just the first one.
    assert twiml.count(f'language="{voice.locale}"') == 2


def test_unsupported_language_falls_back_loudly(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Somali has no Twilio <Say> voice.

    The fallback itself is fine; a *silent* fallback is the bug — it is how the
    hardcoded sw-KE went unnoticed. Assert the warning, not just the locale.
    """
    with caplog.at_level(logging.WARNING, logger="dira.dispatch.twilio"):
        twiml = _adapter().twiml("file:///tmp/alert.mp3", "so")

    assert f'language="{SAY_VOICES["en"].locale}"' in twiml
    assert "no voice for language 'so'" in caplog.text


def test_say_voice_ignores_region_suffix() -> None:
    assert say_voice("sw-KE") == SAY_VOICES["sw"]
    assert say_voice(None) == SAY_VOICES["sw"]


def test_call_passes_language_to_the_fetched_twiml(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_post(_client: httpx.Client, url: str, **kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return httpx.Response(
            201, json={"sid": "CAfake"}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    _adapter().call("+15551234567", "file:///tmp/a.mp3", "idem-lang", language="en")

    payload = captured["data"]
    assert isinstance(payload, dict)
    assert "language=en" in payload["Url"]


def test_call_uses_url_not_inline_twiml(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_post(
        _client: httpx.Client,
        url: str,
        **kwargs: object,
    ) -> httpx.Response:
        captured["url"] = url
        captured.update(kwargs)
        return httpx.Response(
            201,
            json={"sid": "CAfake"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)

    provider_ref = _adapter().call(
        "+15551234567",
        "https://example.org/audio/a.mp3",
        "idem-1",
    )

    payload = captured["data"]
    assert isinstance(payload, dict)
    assert "Url" in payload
    assert "Twiml" not in payload
    # Trial accounts reject explicit HTTP-method params; Twilio defaults both to
    # POST, so they must be omitted (behaviour-neutral on paid accounts).
    assert "Method" not in payload
    assert "StatusCallbackMethod" not in payload
    assert payload["StatusCallback"].endswith("/webhooks/twilio/status")
    assert payload["StatusCallbackEvent"] == "completed"
    assert provider_ref.provider_message_id == "CAfake"


def test_sms_posts_message_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(
        _client: httpx.Client,
        url: str,
        **kwargs: object,
    ) -> httpx.Response:
        captured["url"] = url
        captured.update(kwargs)
        return httpx.Response(
            201,
            json={"sid": "SMfake"},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    provider_ref = _sms_adapter().send("+15551234567", "Habari", "sms-idem")

    assert str(captured["url"]).endswith("/Messages.json")
    assert captured["data"] == {
        "To": "+15551234567",
        "From": "+15550001111",
        "Body": "Habari",
    }
    assert provider_ref == "SMfake"
