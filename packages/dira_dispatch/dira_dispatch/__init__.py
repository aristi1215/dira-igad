"""Dispatch adapters: Africa's Talking, mock voice, and prerecorded TTS."""

from __future__ import annotations

from dira_dispatch.at_adapter import AfricasTalkingAdapter
from dira_dispatch.mock import MockCall, MockDispatcher
from dira_dispatch.tts import PrerecordedAudioAdapter

__all__ = [
    "AfricasTalkingAdapter",
    "MockCall",
    "MockDispatcher",
    "PrerecordedAudioAdapter",
]
