"""Shared worker settings."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_mode: Literal["seeded", "live"] = "seeded"
    database_url: str = "postgresql://dira:dira@localhost:5432/dira"
    zombie_timeout_minutes: int = 10
    dispatch_poll_seconds: int = 30
    max_dispatch_attempts: int = 5
    resolve_after_cycles_below_threshold: int = 3
    public_base_url: str = "http://localhost:8000"
    mock_ack_delay_seconds: float = 2.0
    anthropic_api_key: str | None = None
    at_username: str | None = None
    at_api_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
