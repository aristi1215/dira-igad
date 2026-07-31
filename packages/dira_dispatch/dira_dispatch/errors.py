"""Provider error classification shared by the Twilio adapters."""

from __future__ import annotations

import httpx


class PermanentDispatchError(RuntimeError):
    """A provider rejection that retrying cannot fix (bad/unverified number,
    geo-permission, trial restriction). Carries Twilio's own error code and
    message so operators see the real reason, not an HTTP status line."""

    def __init__(self, message: str, *, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


def raise_for_provider_status(response: httpx.Response) -> None:
    """Raise a readable error for non-2xx Twilio responses.

    4xx responses are permanent — Twilio rejected the request itself (e.g.
    573002 "not a verified recipient" on trial accounts, 21211 invalid number,
    21215 geo-permissions) — so they raise PermanentDispatchError with the
    provider's code and message. 5xx and transport-level statuses stay
    retryable via httpx.HTTPStatusError.
    """
    if response.is_success:
        return
    code: int | None = None
    message = ""
    try:
        body = response.json()
        code = int(body.get("code")) if body.get("code") is not None else None
        message = str(body.get("message") or "")
    except Exception:  # noqa: BLE001 - non-JSON error body
        message = response.text[:300]
    if code:
        detail = f"Twilio error {code}: {message}"
    else:
        detail = f"Twilio HTTP {response.status_code}: {message}"
    if 400 <= response.status_code < 500:
        raise PermanentDispatchError(detail, code=code)
    raise httpx.HTTPStatusError(detail, request=response.request, response=response)
