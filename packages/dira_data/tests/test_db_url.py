"""Unit tests for dual-DB URL resolution."""

from __future__ import annotations

import os

from dira_data.db_url import resolve_database_url


def test_resolve_prefers_live_when_mode_live(monkeypatch) -> None:
    monkeypatch.setenv("DATA_MODE", "live")
    monkeypatch.setenv("DATABASE_URL_SEEDED", "postgresql://s/seeded")
    monkeypatch.setenv("DATABASE_URL_LIVE", "postgresql://s/live")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert resolve_database_url() == "postgresql://s/live"


def test_resolve_prefers_seeded_when_mode_seeded(monkeypatch) -> None:
    monkeypatch.setenv("DATA_MODE", "seeded")
    monkeypatch.setenv("DATABASE_URL_SEEDED", "postgresql://s/seeded")
    monkeypatch.setenv("DATABASE_URL_LIVE", "postgresql://s/live")
    assert resolve_database_url() == "postgresql://s/seeded"


def test_legacy_single_url_when_no_dual(monkeypatch) -> None:
    monkeypatch.setenv("DATA_MODE", "seeded")
    monkeypatch.delenv("DATABASE_URL_SEEDED", raising=False)
    monkeypatch.delenv("DATABASE_URL_LIVE", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://s/legacy")
    assert resolve_database_url() == "postgresql://s/legacy"
