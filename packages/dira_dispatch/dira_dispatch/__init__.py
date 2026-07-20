"""Dispatch: voice/TTS adapters, retry backoff. The daemon lives in apps/worker."""

from __future__ import annotations

from dira_dispatch.adapters import (
    AfricasTalkingAdapter,
    MockDispatcher,
    PrerecordedAudioAdapter,
    TtsProviderAdapter,
    voice_channel,
)
from dira_dispatch.backoff import BACKOFF_SECONDS, backoff_seconds

__all__ = [
    "AfricasTalkingAdapter",
    "BACKOFF_SECONDS",
    "MockDispatcher",
    "PrerecordedAudioAdapter",
    "TtsProviderAdapter",
    "backoff_seconds",
    "voice_channel",
]
