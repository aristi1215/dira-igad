"""Dispatch adapters: Twilio voice (live), mock voice (seeded), and TTS."""

from __future__ import annotations

from dira_dispatch.mock import MockCall, MockDispatcher
from dira_dispatch.tts import (
    ElevenLabsAdapter,
    PrerecordedAudioAdapter,
    get_speech_synthesizer,
)
from dira_dispatch.twilio_adapter import TwilioVoiceAdapter, build_voice_twiml

__all__ = [
    "ElevenLabsAdapter",
    "MockCall",
    "MockDispatcher",
    "PrerecordedAudioAdapter",
    "TwilioVoiceAdapter",
    "build_voice_twiml",
    "get_speech_synthesizer",
]
