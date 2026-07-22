"""Dispatch daemon — two short transactions; provider call outside both.

Usage:
  python -m dira_worker.dispatch
"""

from __future__ import annotations

import argparse
import logging
import threading
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from dira_core.ports import VoiceChannel
from dira_core.time import dispatch_backoff_delta
from dira_data.db import connect
from dira_dispatch import MockDispatcher, PrerecordedAudioAdapter

from dira_worker.settings import Settings, get_settings

logger = logging.getLogger("dira.dispatch")


def claim_next(conn: Any) -> dict[str, Any] | None:
    """Tx A: claim one queued delivery with FOR UPDATE SKIP LOCKED."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id, d.alert_id, d.recipient_id, d.channel, d.idempotency_key,
                       d.attempt_count, r.phone_e164, a.audio_url, a.body_text
                FROM deliveries d
                JOIN recipients r ON r.id = d.recipient_id
                JOIN alerts a ON a.id = d.alert_id
                WHERE d.status = 'queued'
                  AND d.next_attempt_at <= now()
                ORDER BY d.next_attempt_at
                FOR UPDATE OF d SKIP LOCKED
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if row is None:
                return None
            cur.execute(
                """
                UPDATE deliveries
                SET status = 'sending', claimed_at = now(), updated_at = now()
                WHERE id = %s
                """,
                (row["id"],),
            )
            return dict(row)


def record_success(conn: Any, delivery_id: UUID, provider_message_id: str) -> None:
    """Tx B: record successful provider handoff."""
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE deliveries
                SET status = 'sent',
                    provider_message_id = %s,
                    updated_at = now(),
                    last_error = NULL
                WHERE id = %s
                """,
                (provider_message_id, delivery_id),
            )
            cur.execute(
                """
                UPDATE alerts SET status = 'dispatching', updated_at = now()
                WHERE id = (SELECT alert_id FROM deliveries WHERE id = %s)
                  AND status = 'approved'
                """,
                (delivery_id,),
            )


def record_failure(
    conn: Any,
    delivery_id: UUID,
    attempt_count: int,
    error: str,
    settings: Settings,
) -> None:
    """Tx B: backoff or needs_review."""
    next_attempt = attempt_count + 1
    with conn.transaction():
        with conn.cursor() as cur:
            if next_attempt >= settings.max_dispatch_attempts:
                cur.execute(
                    """
                    UPDATE deliveries
                    SET status = 'needs_review',
                        attempt_count = %s,
                        last_error = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (next_attempt, error, delivery_id),
                )
            else:
                delay = dispatch_backoff_delta(next_attempt)
                cur.execute(
                    """
                    UPDATE deliveries
                    SET status = 'queued',
                        attempt_count = %s,
                        next_attempt_at = %s,
                        last_error = %s,
                        claimed_at = NULL,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    (
                        next_attempt,
                        datetime.now(UTC) + delay,
                        error,
                        delivery_id,
                    ),
                )


def sweep_zombies(conn: Any, settings: Settings) -> int:
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.zombie_timeout_minutes)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE deliveries
                SET status = 'needs_review',
                    last_error = COALESCE(last_error, '') || ' | zombie_timeout',
                    updated_at = now()
                WHERE status = 'sending'
                  AND claimed_at IS NOT NULL
                  AND claimed_at < %s
                """,
                (cutoff,),
            )
            return cur.rowcount


def requeue_needs_review(conn: Any, delivery_id: UUID) -> None:
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE deliveries
                SET status = 'queued',
                    next_attempt_at = now(),
                    claimed_at = NULL,
                    updated_at = now()
                WHERE id = %s AND status = 'needs_review'
                """,
                (delivery_id,),
            )


def process_one(
    conn: Any,
    voice: VoiceChannel,
    settings: Settings,
    *,
    audio_fallback: str,
) -> bool:
    """Claim → call outside Tx → record. Returns True if work was done."""
    claimed = claim_next(conn)
    if claimed is None:
        return False

    delivery_id = claimed["id"]
    phone = claimed["phone_e164"]
    audio_url = claimed["audio_url"] or audio_fallback
    idem = claimed["idempotency_key"]
    attempts = int(claimed["attempt_count"])

    # CRITICAL: no open transaction while calling the provider (invariant 5).
    assert conn.info.transaction_status == 0 or True  # checked via instrumentation in tests
    try:
        from psycopg.pq import TransactionStatus

        if conn.info.transaction_status != TransactionStatus.IDLE:
            raise RuntimeError("Provider call attempted inside an open transaction")
        ref = voice.call(phone, audio_url, idem)
        record_success(conn, delivery_id, ref.provider_message_id)
        # Schedule seeded ack AFTER provider_message_id is durable (avoids race +
        # --once process exit killing the timer before Tx B commits).
        if isinstance(voice, MockDispatcher) and voice.database_url:
            delay = voice.ack_delay_seconds or 0.0
            if delay <= 0:
                voice._db_ack(ref)
            else:
                timer = threading.Timer(delay, voice._db_ack, args=(ref,))
                timer.daemon = True
                timer.start()
        logger.info("Dispatched delivery=%s provider=%s", delivery_id, ref.provider_message_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Dispatch failed delivery=%s: %s", delivery_id, exc)
        record_failure(conn, delivery_id, attempts, str(exc), settings)
    return True


def run_loop(
    *,
    settings: Settings | None = None,
    voice: VoiceChannel | None = None,
    once: bool = False,
) -> None:
    import time

    settings = settings or get_settings()
    tts = PrerecordedAudioAdapter()
    audio = tts.synthesize("generic alert", "sw")
    # Disable built-in call()-time ack; process_one schedules ack after Tx B.
    voice = voice or MockDispatcher(
        ack_delay_seconds=settings.mock_ack_delay_seconds,
        database_url=settings.database_url,
        ack_callback=None,
    )

    with connect(settings.database_url) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("LISTEN dira_events")

        while True:
            sweep_zombies(conn, settings)
            process_one(conn, voice, settings, audio_fallback=audio.url)
            if once:
                for _ in range(50):
                    if not process_one(conn, voice, settings, audio_fallback=audio.url):
                        break
                # Allow delayed mock acks to land before exit.
                time.sleep(max(0.5, float(settings.mock_ack_delay_seconds) + 0.5))
                return

            # Block until a NOTIFY arrives or the poll interval elapses,
            # draining any queued notifications (psycopg3 generator API).
            for _ in conn.notifies(timeout=settings.dispatch_poll_seconds, stop_after=1):
                pass


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Dira dispatch daemon")
    parser.add_argument("--once", action="store_true", help="Process queue once and exit")
    args = parser.parse_args(argv)
    run_loop(once=args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
