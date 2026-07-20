"""Hexagonal ports: the domain defines interfaces and knows no adapters.

Every external dependency has a Protocol here and a live + seeded/fallback
adapter elsewhere. DATA_MODE=seeded|live swaps data adapters together.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class ConflictEvent:
    """Conflict event from an external conflict data source (e.g. ACLED)."""

    event_id: str
    event_date: date
    zone_id: str | None
    event_type: str
    fatalities: int
    notes: str | None = None
    actor1: str | None = None
    actor2: str | None = None
    lon: float | None = None
    lat: float | None = None
    available_at: datetime | None = None


@dataclass(frozen=True)
class FeatureRow:
    """One zone × dekada feature vector for risk assessment."""

    zone_id: str
    dekad_start: date
    values: dict[str, float | None]


@dataclass(frozen=True)
class Assessment:
    """Three model outputs plus SHAP breakdown."""

    prob_conflict: float
    expected_incidents: float
    model_risk: float
    model_band: str
    shap: dict[str, float]


@dataclass(frozen=True)
class AudioRef:
    """Reference to synthesized or pre-recorded audio."""

    url: str
    language: str
    duration_seconds: float | None = None


@dataclass(frozen=True)
class ProviderRef:
    """Opaque provider message/session identifier."""

    provider_message_id: str
    raw: dict[str, Any] | None = None


@runtime_checkable
class ConflictDataSource(Protocol):
    def events(self, zone_ids: list[str], since: date) -> list[ConflictEvent]: ...


@runtime_checkable
class HazardDataSource(Protocol):
    def fetch_dekadal(
        self, zone_ids: list[str], dekad_start: date
    ) -> dict[str, dict[str, float | None]]: ...


@runtime_checkable
class RiskModel(Protocol):
    def assess(self, features: FeatureRow) -> Assessment: ...


@runtime_checkable
class LanguageModel(Protocol):
    def complete(self, prompt: str, *, system: str | None = None) -> str: ...

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]: ...


@runtime_checkable
class EmbeddingModel(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


@runtime_checkable
class VoiceChannel(Protocol):
    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef: ...


@runtime_checkable
class SpeechSynthesizer(Protocol):
    def synthesize(self, text: str, language: str) -> AudioRef: ...


@runtime_checkable
class Clock(Protocol):
    """Injected clock so seeded tests never assert against wall-clock now()."""

    def now(self) -> datetime: ...
