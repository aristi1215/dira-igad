"""Speech synthesizer adapters."""

from __future__ import annotations

from pathlib import Path

from dira_core.ports import AudioRef

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AUDIO_DIR = ROOT / "data" / "seeded" / "audio"


class PrerecordedAudioAdapter:
    """Return seeded pre-recorded audio/text references by language."""

    def __init__(self, audio_dir: str | Path = DEFAULT_AUDIO_DIR) -> None:
        self.audio_dir = Path(audio_dir)

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
