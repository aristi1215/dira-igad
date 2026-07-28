"""Dispatch adapters: Twilio voice (live), mock voice (seeded), and TTS."""

from __future__ import annotations

from dira_dispatch.mock import MockCall, MockDispatcher
from dira_dispatch.tts import (
    ElevenLabsAdapter,
    PrerecordedAudioAdapter,
    get_speech_synthesizer,
)
from dira_dispatch.twilio_adapter import TwilioVoiceAdapter

__all__ = [
    "ElevenLabsAdapter",
    "MockCall",
    "MockDispatcher",
    "PrerecordedAudioAdapter",
    "TwilioVoiceAdapter",
    "get_speech_synthesizer",
]
