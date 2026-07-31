"""Twilio voice adapter (replaces Africa's Talking — DEVIATIONS D-018).

The adapter places one outbound call per delivery. The call plays the alert
audio (ElevenLabs mp3 hosted under PUBLIC_BASE_URL/audio/…) or falls back to
Twilio <Say>, then gathers one DTMF digit which lands on
POST /webhooks/twilio/gather. Call lifecycle updates land on
POST /webhooks/twilio/status. Both webhooks are idempotent server-side.
"""

from __future__ import annotations

import logging
import os
from typing import Any, NamedTuple
from urllib.parse import urlencode
from xml.sax.saxutils import escape

import httpx
from dira_core.ports import ProviderRef

logger = logging.getLogger("dira.dispatch.twilio")

DEFAULT_API_BASE = "https://api.twilio.com"

DEFAULT_LANGUAGE = "sw"


class SayVoice(NamedTuple):
    """The three things a <Say> needs, kept together on purpose.

    Locale and text must agree: speaking Amharic words with an English voice is
    worse than speaking English words with an English voice. So an unsupported
    language falls back on *both* at once, never on the locale alone.
    """

    locale: str
    alert_text: str
    ack_prompt: str


# Only languages Twilio's <Say> actually voices. Everything else in the alert
# language dropdown (Amharic, Somali) has no TTS voice here and degrades to
# English with a logged warning — a silent degrade is the bug this map exists
# to fix.
SAY_VOICES: dict[str, SayVoice] = {
    "sw": SayVoice(
        "sw-KE",
        "Tahadhari ya Dira. Hali ya hatari imeongezeka katika eneo lako. "
        "Tafadhali chukua hatua za maandalizi.",
        "Bonyeza moja kuthibitisha kupokea tahadhari hii.",
    ),
    "en": SayVoice(
        "en-GB",
        "Dira alert. Risk has increased in your area. "
        "Please take preparatory action.",
        "Press one to confirm you received this alert.",
    ),
    "ar": SayVoice(
        "arb",
        "تنبيه ديرا. ازداد الخطر في منطقتك. يرجى اتخاذ إجراءات احترازية.",
        "اضغط واحد لتأكيد استلام هذا التنبيه.",
    ),
}

FALLBACK_VOICE_LANGUAGE = "en"

# Kept for backwards compatibility — the Swahili generic alert text.
FALLBACK_SAY = SAY_VOICES["sw"].alert_text


def say_voice(language: str | None) -> SayVoice:
    """Resolve a language code to a <Say> voice, loudly."""
    code = (language or DEFAULT_LANGUAGE).split("-")[0].lower()
    voice = SAY_VOICES.get(code)
    if voice is None:
        logger.warning(
            "Twilio <Say> has no voice for language %r; speaking %s instead. "
            "Recipients in this language get an English fallback until "
            "a TTS provider supplies audio.",
            language,
            FALLBACK_VOICE_LANGUAGE,
        )
        return SAY_VOICES[FALLBACK_VOICE_LANGUAGE]
    return voice


def build_voice_twiml(
    audio_url: str, gather_action: str, language: str | None = None
) -> str:
    """Build the outbound-call TwiML: play the alert audio (or <Say> fallback),
    then gather one DTMF digit to the acknowledgement webhook.

    The <Say> branch speaks a *generic* alert, not the drafted body: this TwiML
    is served from a public unauthenticated URL, so the alert text stays out of
    it. Real alert wording reaches recipients through the synthesized <Play>
    audio.
    """
    voice = say_voice(language)
    if audio_url.startswith(("http://", "https://")):
        payload = f"<Play>{escape(audio_url)}</Play>"
    else:
        payload = f'<Say language="{voice.locale}">{escape(voice.alert_text)}</Say>'
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"{payload}"
        f'<Gather action="{escape(gather_action, {chr(34): "&quot;"})}" '
        'method="POST" numDigits="1" timeout="8">'
        f'<Say language="{voice.locale}">{escape(voice.ack_prompt)}</Say>'
        "</Gather>"
        "</Response>"
    )


class TwilioVoiceAdapter:
    """Minimal live wrapper; raises clearly when credentials are absent."""

    def __init__(
        self,
        account_sid: str | None = None,
        *,
        api_key_sid: str | None = None,
        api_key_secret: str | None = None,
        auth_token: str | None = None,
        from_number: str | None = None,
        api_base_url: str | None = None,
        public_base_url: str | None = None,
    ) -> None:
        self.account_sid = account_sid or os.environ.get("TWILIO_ACCOUNT_SID")
        self.api_key_sid = api_key_sid or os.environ.get("TWILIO_API_KEY_SID")
        self.api_key_secret = api_key_secret or os.environ.get("TWILIO_API_KEY_SECRET")
        self.auth_token = auth_token or os.environ.get("TWILIO_AUTH_TOKEN")
        self.from_number = from_number or os.environ.get("TWILIO_FROM_NUMBER")
        self.api_base_url = (
            api_base_url or os.environ.get("TWILIO_API_BASE_URL") or DEFAULT_API_BASE
        ).rstrip("/")
        self.public_base_url = (
            public_base_url or os.environ.get("PUBLIC_BASE_URL") or "http://localhost:8000"
        ).rstrip("/")
        if not self.account_sid or not self.from_number:
            raise RuntimeError(
                "TWILIO_ACCOUNT_SID and TWILIO_FROM_NUMBER are required for TwilioVoiceAdapter."
            )
        if self.api_key_sid and self.api_key_secret:
            self._auth = (self.api_key_sid, self.api_key_secret)
        elif self.auth_token:
            self._auth = (self.account_sid, self.auth_token)
        else:
            raise RuntimeError(
                "Either TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN "
                "is required for TwilioVoiceAdapter."
            )

    def twiml(self, audio_url: str, language: str | None = None) -> str:
        return build_voice_twiml(
            audio_url,
            f"{self.public_base_url}/webhooks/twilio/gather",
            language,
        )

    def voice_url(self, audio_url: str, language: str | None = None) -> str:
        params = {"audio_url": audio_url, "language": language or DEFAULT_LANGUAGE}
        return f"{self.public_base_url}/webhooks/twilio/voice?{urlencode(params)}"

    def call(
        self,
        phone: str,
        audio_url: str,
        idem_key: str,
        *,
        language: str = DEFAULT_LANGUAGE,
    ) -> ProviderRef:
        status_callback = f"{self.public_base_url}/webhooks/twilio/status"
        # Twilio defaults both the TwiML `Url` fetch and the `StatusCallback`
        # POST to HTTP POST, so we omit the explicit `Method`/`StatusCallbackMethod`
        # params: behaviour is identical on paid accounts, and trial accounts
        # reject those two params ("disallowed parameters" 400).
        payload = {
            "To": phone,
            "From": self.from_number,
            "Url": self.voice_url(audio_url, language),
            "StatusCallback": status_callback,
            "StatusCallbackEvent": "completed",
        }
        url = f"{self.api_base_url}/2010-04-01/Accounts/{self.account_sid}/Calls.json"
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                url,
                data=payload,
                auth=self._auth,
                headers={"Idempotency-Key": idem_key},
            )
            response.raise_for_status()
            raw: dict[str, Any] = response.json()
        provider_id = str(raw.get("sid") or raw.get("call_sid") or idem_key)
        return ProviderRef(provider_message_id=provider_id, raw=raw)
