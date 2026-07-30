"""Resolve DATABASE_URL from DATA_MODE and dual-DB env vars."""

from __future__ import annotations

import os


DEFAULT_SEEDED = "postgresql://dira:dira@localhost:55432/dira"
DEFAULT_LIVE = "postgresql://dira:dira@localhost:55432/dira_live"


def resolve_database_url(
    *,
    data_mode: str | None = None,
    database_url: str | None = None,
    database_url_seeded: str | None = None,
    database_url_live: str | None = None,
) -> str:
    """Pick the Postgres URL for the active data mode.

    Precedence:
      1. Explicit ``database_url`` argument / ``DATABASE_URL`` when mode-specific
         URLs are unset (legacy single-DB setups).
      2. ``DATABASE_URL_LIVE`` when ``DATA_MODE=live``.
      3. ``DATABASE_URL_SEEDED`` when ``DATA_MODE=seeded``.
      4. Sensible localhost defaults on port 55432.
    """
    mode = (data_mode or os.environ.get("DATA_MODE", "seeded")).strip().lower()
    seeded = (
        database_url_seeded
        or os.environ.get("DATABASE_URL_SEEDED")
        or DEFAULT_SEEDED
    )
    live = (
        database_url_live
        or os.environ.get("DATABASE_URL_LIVE")
        or DEFAULT_LIVE
    )
    explicit = database_url if database_url is not None else os.environ.get("DATABASE_URL")

    # If the operator set only DATABASE_URL (legacy), honour it unless the
    # mode-specific twin is also configured.
    has_dual = bool(
        os.environ.get("DATABASE_URL_SEEDED") or os.environ.get("DATABASE_URL_LIVE")
        or database_url_seeded or database_url_live
    )
    if mode == "live":
        if has_dual or database_url_live or os.environ.get("DATABASE_URL_LIVE"):
            return live
        return explicit or live
    if has_dual or database_url_seeded or os.environ.get("DATABASE_URL_SEEDED"):
        return seeded
    return explicit or seeded
