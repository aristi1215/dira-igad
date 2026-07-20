"""Ingestion protocols. Each returns rows filtered to available_at <= cutoff (invariant 2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ClimateSource(Protocol):
    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:
        """Dekadal climate rows; each column group masked to NULL if published after cutoff."""
        ...


@runtime_checkable
class EventSource(Protocol):
    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:
        """ACLED event rows with available_at <= cutoff."""
        ...


@runtime_checkable
class NewsSource(Protocol):
    def fetch(self, cutoff: datetime) -> list[dict[str, Any]]:
        """News documents (with canned signals) with available_at <= cutoff."""
        ...
