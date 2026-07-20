"""Dispatch daemon (ADR 4/15/16). LISTEN dira_dispatch + 30s polling safety net.

Loop per cycle:
  1. zombie sweep (sending > timeout -> needs_review)
  2. claim one due delivery (Tx A: FOR UPDATE SKIP LOCKED -> sending)
  3. call the provider OUTSIDE any transaction (invariant 5)
  4. record the result (Tx B: sent, or backoff/needs_review)

The provider call is deliberately between two short transactions so a crash cannot hold a row
locked forever; the zombie sweep recovers anything stuck in 'sending'.
"""

from __future__ import annotations

import sys
import time
from typing import Any

import psycopg
from dira_data.db import connect
from dira_data.repositories import dispatch as dq
from dira_data.schema import ensure_schema
from dira_dispatch import backoff_seconds, voice_channel

from dira_worker.settings import get_settings


def _audio_url(base_url: str, language: str) -> str:
    return f"{base_url}/static/audio/{language}.xml"


def process_one(
    conn: psycopg.Connection,
    channel: Any,
    *,
    max_attempts: int,
    base_url: str = "http://localhost:8000",
) -> bool:
    """Claim + send + record one delivery. Returns False when the queue is empty."""
    delivery = dq.claim_one(conn)  # Tx A
    if delivery is None:
        return False

    audio_url = _audio_url(base_url, delivery.get("language") or "sw")
    # --- Provider call: OUTSIDE any transaction. ---
    try:
        ref = channel.call(delivery["phone"], audio_url, delivery["idempotency_key"])
    except Exception as exc:  # provider/network failure
        attempts = delivery["attempts"]
        dq.record_failure(
            conn, delivery["id"], str(exc),
            exhausted=attempts >= max_attempts,
            delay_seconds=backoff_seconds(attempts),
        )  # Tx B
        return True

    dq.record_success(conn, delivery["id"], ref.provider_message_id)  # Tx B
    # Seeded demo: MockDispatcher requests a simulated acknowledgement (map turns green).
    if ref.raw and ref.raw.get("simulate_ack"):
        delay = getattr(channel, "ack_delay_seconds", 0.0)
        if delay:
            time.sleep(delay)
        dq.simulate_ack(conn, ref.provider_message_id)
    return True


def run_cycle(conn: psycopg.Connection, channel: Any, *, max_attempts: int, timeout_minutes: int,
              base_url: str = "http://localhost:8000") -> int:
    """One daemon pass: sweep zombies, then drain the due queue. Returns deliveries processed."""
    dq.sweep_zombies(conn, timeout_minutes)
    processed = 0
    while process_one(conn, channel, max_attempts=max_attempts, base_url=base_url):
        processed += 1
    return processed


def main() -> int:
    settings = get_settings()
    conn = connect(autocommit=True)
    ensure_schema(conn)
    channel = voice_channel(settings.data_mode)
    listen = connect(autocommit=True)
    listen.execute("LISTEN dira_dispatch")
    print(f"[dispatch] started mode={settings.data_mode} poll={settings.dispatch_poll_seconds}s")
    try:
        while True:
            run_cycle(
                conn, channel,
                max_attempts=settings.max_dispatch_attempts,
                timeout_minutes=settings.zombie_timeout_minutes,
                base_url=getattr(settings, "public_base_url", "http://localhost:8000"),
            )
            # Wait for a NOTIFY or fall back to the 30s poll.
            gen = listen.notifies(timeout=settings.dispatch_poll_seconds)
            for _ in gen:
                break
    except KeyboardInterrupt:  # pragma: no cover
        print("[dispatch] stopping", file=sys.stderr)
    finally:
        conn.close()
        listen.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
