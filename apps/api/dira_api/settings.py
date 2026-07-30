"""Application settings. Implementation agent: wire adapters from DATA_MODE."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from dira_data.db_url import resolve_database_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_mode: Literal["seeded", "live"] = "seeded"
    database_url: str = "postgresql://dira:dira@localhost:55432/dira"
    database_url_seeded: str | None = None
    database_url_live: str | None = None
    ee_project: str | None = None
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    acled_email: str | None = None
    acled_password: str | None = None
    public_base_url: str = "http://localhost:8000"
    webhook_shared_secret: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None

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
