"""Speech synthesizer adapters: seeded prerecorded audio and live ElevenLabs."""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

from dira_core.ports import AudioRef

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AUDIO_DIR = ROOT / "data" / "seeded" / "audio"
DEFAULT_SYNTH_DIR = ROOT / "artifacts" / "audio"


def _default_audio_dir() -> Path:
    """Locate the seeded audio fixtures.

    The ``__file__``-relative default only works for an editable install; when
    the package is pip-installed (e.g. in the prod containers) it resolves into
    site-packages where no ``data/`` exists. Honour ``SEEDED_DATA_DIR`` — the
    same convention the data adapters use — so the fixtures are found there.
    """
    seeded = os.environ.get("SEEDED_DATA_DIR")
    return Path(seeded) / "audio" if seeded else DEFAULT_AUDIO_DIR


class PrerecordedAudioAdapter:
    """Return seeded pre-recorded audio/text references by language."""

    def __init__(self, audio_dir: str | Path | None = None) -> None:
        self.audio_dir = Path(audio_dir) if audio_dir is not None else _default_audio_dir()

    def synthesize(self, text: str, language: str) -> AudioRef:
        language_dir = self.audio_dir / language
        candidates = [
            language_dir / "alert_generic.mp3",
            language_dir / "alert_generic.wav",
            language_dir / "alert_generic.txt",
        ]
        for candidate in candidates:
            if candidate.exists():
                return AudioRef(url=candidate.as_uri(), language=language)
        raise RuntimeError(f"No prerecorded audio fixture found for language {language!r}.")


class ElevenLabsAdapter:
    """Live TTS: synthesize alert audio to mp3 files served under /audio.

    Files are content-addressed (sha256 of text+voice) so re-dispatching the
    same alert reuses the cached mp3 instead of re-billing the API.
    """

    API_BASE = "https://api.elevenlabs.io/v1"

    def __init__(
        self,
        api_key: str | None = None,
        voice_id: str | None = None,
        *,
        output_dir: str | Path = DEFAULT_SYNTH_DIR,
        public_base_url: str | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("TTS_API_KEY")
        self.voice_id = voice_id or os.environ.get("TTS_VOICE_ID")
        self.output_dir = Path(output_dir)
        self.public_base_url = (
            public_base_url or os.environ.get("PUBLIC_BASE_URL") or "http://localhost:8000"
        ).rstrip("/")
        if not self.api_key or not self.voice_id:
            raise RuntimeError("TTS_API_KEY and TTS_VOICE_ID are required for ElevenLabsAdapter.")

    def synthesize(self, text: str, language: str) -> AudioRef:
        import httpx

        digest = hashlib.sha256(f"{self.voice_id}:{language}:{text}".encode()).hexdigest()[:24]
        filename = f"alert_{digest}.mp3"
        path = self.output_dir / filename
        if not path.exists():
            self.output_dir.mkdir(parents=True, exist_ok=True)
            with httpx.Client(timeout=60.0) as client:
                response = client.post(
                    f"{self.API_BASE}/text-to-speech/{self.voice_id}",
                    headers={"xi-api-key": self.api_key, "Accept": "audio/mpeg"},
                    json={
                        "text": text,
                        "model_id": "eleven_multilingual_v2",
                        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                    },
                )
                response.raise_for_status()
                path.write_bytes(response.content)
        return AudioRef(url=f"{self.public_base_url}/audio/{filename}", language=language)


def get_speech_synthesizer(
    *,
    tts_provider: str | None = None,
    tts_api_key: str | None = None,
    tts_voice_id: str | None = None,
    public_base_url: str | None = None,
) -> PrerecordedAudioAdapter | ElevenLabsAdapter:
    """ElevenLabs when configured; otherwise seeded prerecorded audio."""
    provider = (tts_provider or os.environ.get("TTS_PROVIDER") or "").lower()
    key = tts_api_key or os.environ.get("TTS_API_KEY")
    voice = tts_voice_id or os.environ.get("TTS_VOICE_ID")
    if provider == "elevenlabs" and key and voice:
        try:
            return ElevenLabsAdapter(key, voice, public_base_url=public_base_url)
        except Exception:  # noqa: BLE001
            logger.exception("ElevenLabs unavailable; falling back to prerecorded audio")
    return PrerecordedAudioAdapter()
