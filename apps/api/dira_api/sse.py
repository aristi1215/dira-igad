"""Server-Sent Events: one dedicated LISTEN connection relays dira_events (ADR 5/6).

Payloads are minimal (ids + status) — well under pg_notify's 8000-byte limit by design.
Heartbeat every 15s (sse-starlette ping); the client reconnects and refetches on reconnect.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import psycopg
from sse_starlette.sse import EventSourceResponse

from dira_api.settings import get_settings


async def _listen() -> AsyncIterator[dict[str, str]]:
    settings = get_settings()
    aconn = await psycopg.AsyncConnection.connect(settings.database_url, autocommit=True)
    try:
        await aconn.execute("LISTEN dira_events")
        async for notify in aconn.notifies():
            yield {"event": "dira", "data": notify.payload}
    finally:
        await aconn.close()


def event_source() -> EventSourceResponse:
    # ping=15 emits a heartbeat comment every 15s so proxies keep the stream open.
    return EventSourceResponse(_listen(), ping=15)
