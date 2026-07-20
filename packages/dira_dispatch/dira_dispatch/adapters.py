"""VoiceChannel + SpeechSynthesizer adapters: Africa's Talking (live) and mock (seeded)."""

from __future__ import annotations

import hashlib
import os
from typing import Any

from dira_core.ports import AudioRef, ProviderRef


class AfricasTalkingAdapter:
    """Live VoiceChannel via the Africa's Talking voice API (pre-generated audio + <Play>)."""

    def __init__(self, username: str | None = None, api_key: str | None = None) -> None:
        self.username = username or os.environ.get("AFRICAS_TALKING_USERNAME")
        self.api_key = api_key or os.environ.get("AFRICAS_TALKING_API_KEY")

    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef:  # pragma: no cover
        if not self.username or not self.api_key:
            raise RuntimeError("Africa's Talking credentials missing")
        import africastalking  # type: ignore[import-not-found]

        africastalking.initialize(self.username, self.api_key)
        voice = africastalking.Voice
        resp = voice.call({"callFrom": os.environ.get("AFRICAS_TALKING_SHORTCODE", ""),
                           "callTo": [phone]})
        entries = resp.get("entries", [{}]) if isinstance(resp, dict) else [{}]
        session_id = entries[0].get("sessionId") or idem_key
        return ProviderRef(provider_message_id=str(session_id), raw=resp)


class MockDispatcher:
    """Seeded VoiceChannel. Simulates the full cycle; asks the daemon to simulate an ack so the
    demo map goes green without real telephony (invariant 6: nothing external can fail)."""

    def __init__(self, ack_delay_seconds: float = 0.0) -> None:
        self.ack_delay_seconds = ack_delay_seconds
        self.calls: list[tuple[str, str, str]] = []

    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef:
        self.calls.append((phone, audio_url, idem_key))
        # Deterministic provider id derived from the idempotency key.
        pid = "mock-" + hashlib.sha256(idem_key.encode()).hexdigest()[:16]
        return ProviderRef(provider_message_id=pid, raw={"simulate_ack": True})


class PrerecordedAudioAdapter:
    """Seeded SpeechSynthesizer: returns a static URL to a pre-recorded prompt (ADR 18)."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000")

    def synthesize(self, text: str, language: str) -> AudioRef:
        return AudioRef(url=f"{self.base_url}/static/audio/{language}.xml", language=language)


class TtsProviderAdapter:
    """Live SpeechSynthesizer placeholder — pre-generates audio and returns its URL."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000")

    def synthesize(self, text: str, language: str) -> AudioRef:  # pragma: no cover - live only
        digest = hashlib.sha256(text.encode()).hexdigest()[:16]
        return AudioRef(url=f"{self.base_url}/static/audio/{digest}.wav", language=language)


def voice_channel(data_mode: str, **kwargs: Any) -> Any:
    return AfricasTalkingAdapter() if data_mode == "live" else MockDispatcher(**kwargs)
