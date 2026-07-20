"""Africa's Talking voice adapter."""

from __future__ import annotations

import os
import uuid
from typing import Any

import httpx
from dira_core.ports import ProviderRef


class AfricasTalkingAdapter:
    """Minimal live wrapper; raises clearly when credentials are absent."""

    def __init__(
        self,
        username: str | None = None,
        api_key: str | None = None,
        *,
        base_url: str = "https://voice.africastalking.com",
    ) -> None:
        self.username = username or os.environ.get("AT_USERNAME")
        self.api_key = api_key or os.environ.get("AT_API_KEY")
        self.base_url = base_url.rstrip("/")
        if not self.username or not self.api_key:
            raise RuntimeError("AT_USERNAME and AT_API_KEY are required for AfricasTalkingAdapter.")

    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef:
        payload = {"username": self.username, "to": phone, "url": audio_url}
        headers = {"apiKey": self.api_key, "Idempotency-Key": idem_key}
        with httpx.Client(timeout=20.0) as client:
            response = client.post(f"{self.base_url}/call", data=payload, headers=headers)
            response.raise_for_status()
            raw: dict[str, Any] = response.json()
        provider_id = str(raw.get("sessionId") or raw.get("provider_message_id") or uuid.uuid4())
        return ProviderRef(provider_message_id=provider_id, raw=raw)
