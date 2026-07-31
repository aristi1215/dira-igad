"""Shared worker settings."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from dira_data.db_url import resolve_database_url
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_mode: Literal["seeded", "live"] = "seeded"
    database_url: str = "postgresql://dira:dira@localhost:55432/dira"
    database_url_seeded: str | None = None
    database_url_live: str | None = None
    ee_project: str | None = None
    zombie_timeout_minutes: int = 10
    dispatch_poll_seconds: int = 30
    max_dispatch_attempts: int = 5
    resolve_after_cycles_below_threshold: int = 3
    public_base_url: str = "http://localhost:8000"
    mock_ack_delay_seconds: float = 2.0
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    dispatch_mode: Literal["mock", "twilio"] = "mock"
    twilio_account_sid: str | None = None
    twilio_api_key_sid: str | None = None
    twilio_api_key_secret: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None
    twilio_api_base_url: str = "https://api.twilio.com"
    tts_provider: str | None = None
    tts_api_key: str | None = None
    tts_voice_id: str | None = None

    @model_validator(mode="after")
    def _resolve_database_url(self) -> Settings:
        self.database_url = resolve_database_url(
            data_mode=self.data_mode,
            database_url=self.database_url,
            database_url_seeded=self.database_url_seeded,
            database_url_live=self.database_url_live,
        )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
