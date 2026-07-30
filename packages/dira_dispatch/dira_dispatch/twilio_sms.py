"""Twilio SMS adapter."""

from __future__ import annotations

import os
from typing import Any

import httpx

from .twilio_adapter import DEFAULT_API_BASE


class TwilioSmsAdapter:
    """Minimal live Twilio Messaging API wrapper."""

    def __init__(
        self,
        account_sid: str | None = None,
        *,
        api_key_sid: str | None = None,
        api_key_secret: str | None = None,
        auth_token: str | None = None,
        from_number: str | None = None,
        api_base_url: str | None = None,
    ) -> None:
        self.account_sid = account_sid or os.environ.get("TWILIO_ACCOUNT_SID")
        self.api_key_sid = api_key_sid or os.environ.get("TWILIO_API_KEY_SID")
        self.api_key_secret = api_key_secret or os.environ.get("TWILIO_API_KEY_SECRET")
        self.auth_token = auth_token or os.environ.get("TWILIO_AUTH_TOKEN")
        self.from_number = from_number or os.environ.get("TWILIO_FROM_NUMBER")
        self.api_base_url = (
            api_base_url or os.environ.get("TWILIO_API_BASE_URL") or DEFAULT_API_BASE
        ).rstrip("/")
        if not self.account_sid or not self.from_number:
            raise RuntimeError(
                "TWILIO_ACCOUNT_SID and TWILIO_FROM_NUMBER are required for TwilioSmsAdapter."
            )
        if self.api_key_sid and self.api_key_secret:
            self._auth = (self.api_key_sid, self.api_key_secret)
        elif self.auth_token:
            self._auth = (self.account_sid, self.auth_token)
        else:
            raise RuntimeError(
                "Either TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN "
                "is required for TwilioSmsAdapter."
            )

    def send(self, to_e164: str, body: str, idempotency_key: str) -> str:
        url = (
            f"{self.api_base_url}/2010-04-01/Accounts/"
            f"{self.account_sid}/Messages.json"
        )
        payload = {"To": to_e164, "From": self.from_number, "Body": body}
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                url,
                data=payload,
                auth=self._auth,
                headers={"Idempotency-Key": idempotency_key},
            )
            response.raise_for_status()
            raw: dict[str, Any] = response.json()
        provider_id = str(raw.get("sid") or raw.get("message_sid") or idempotency_key)
        return provider_id
