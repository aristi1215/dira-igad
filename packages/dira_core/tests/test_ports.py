"""Ports are runtime-checkable Protocols; a concrete stub must satisfy them structurally."""

from __future__ import annotations

from datetime import date
from typing import Any

from dira_core import ports


class _Everything:
    """A single object structurally implementing every port (for the contract check)."""

    def events(self, zone_ids: list[str], since: date) -> list[ports.ConflictEvent]:
        return []

    def fetch_dekadal(
        self, zone_ids: list[str], dekad_start: date
    ) -> dict[str, dict[str, float | None]]:
        return {}

    def assess(self, features: ports.FeatureRow) -> ports.Assessment:
        return ports.Assessment(0.0, 0.0, 0.0, "green", {})

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        return ""

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        return {}

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.0]]

    def call(self, phone: str, audio_url: str, idem_key: str) -> ports.ProviderRef:
        return ports.ProviderRef("mid")

    def synthesize(self, text: str, language: str) -> ports.AudioRef:
        return ports.AudioRef("url", language)


def test_stub_satisfies_all_ports() -> None:
    stub = _Everything()
    assert isinstance(stub, ports.ConflictDataSource)
    assert isinstance(stub, ports.HazardDataSource)
    assert isinstance(stub, ports.RiskModel)
    assert isinstance(stub, ports.LanguageModel)
    assert isinstance(stub, ports.EmbeddingModel)
    assert isinstance(stub, ports.VoiceChannel)
    assert isinstance(stub, ports.SpeechSynthesizer)


def test_dataclasses_hold_values() -> None:
    ev = ports.ConflictEvent("e1", date(2026, 1, 1), "z", "Violence", 2)
    assert ev.zone_id == "z" and ev.fatalities == 2
    fr = ports.FeatureRow("z", date(2026, 1, 1), {"a": 1.0, "b": None})
    assert fr.values["b"] is None
    ref = ports.ProviderRef("mid", {"k": "v"})
    assert ref.provider_message_id == "mid"
