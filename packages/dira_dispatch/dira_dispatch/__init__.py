"""Dispatch adapters: Twilio voice (live), mock voice (seeded), and TTS."""

from __future__ import annotations

from dira_dispatch.errors import PermanentDispatchError, raise_for_provider_status
from dira_dispatch.mock import MockCall, MockDispatcher, MockMessage
from dira_dispatch.tts import (
    ElevenLabsAdapter,
    PrerecordedAudioAdapter,
    get_speech_synthesizer,
)
from dira_dispatch.twilio_adapter import TwilioVoiceAdapter, build_voice_twiml
from dira_dispatch.twilio_sms import TwilioSmsAdapter

__all__ = [
    "ElevenLabsAdapter",
    "MockCall",
    "MockMessage",
    "MockDispatcher",
    "PermanentDispatchError",
    "PrerecordedAudioAdapter",
    "TwilioVoiceAdapter",
    "TwilioSmsAdapter",
    "build_voice_twiml",
    "get_speech_synthesizer",
    "raise_for_provider_status",
]
