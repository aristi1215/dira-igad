"""Application settings. Implementation agent: wire adapters from DATA_MODE."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    data_mode: Literal["seeded", "live"] = "seeded"
    database_url: str = "postgresql://dira:dira@localhost:5432/dira"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    anthropic_api_key: str | None = None
    acled_email: str | None = None
    acled_password: str | None = None
    africas_talking_username: str | None = None
    africas_talking_api_key: str | None = None
    public_base_url: str = "http://localhost:8000"
    webhook_shared_secret: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
