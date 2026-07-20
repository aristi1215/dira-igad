"""Dispatch queue access (ADR 4/15/16). Two short transactions; the provider call happens
BETWEEN them, never inside one (invariant 5).

Tx A: claim (FOR UPDATE SKIP LOCKED) -> sending + claimed_at (+ attempts++).
Tx B: record the result (sent, or backoff/needs_review).
Zombie sweep: sending older than the timeout -> needs_review (no auto-retry, ADR 16).
"""

from __future__ import annotations

from typing import Any

import psycopg

_CLAIM = """
UPDATE deliveries d
SET status='sending', claimed_at=now(), attempts=attempts+1, updated_at=now()
FROM (
    SELECT id FROM deliveries
    WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
) sub
WHERE d.id = sub.id
RETURNING d.id, d.alert_id, d.recipient_id, d.idempotency_key, d.channel, d.attempts,
          (SELECT phone FROM recipients r WHERE r.id = d.recipient_id) AS phone,
          (SELECT language FROM recipients r WHERE r.id = d.recipient_id) AS language
"""


def claim_one(conn: psycopg.Connection) -> dict[str, Any] | None:
    """Tx A: atomically claim one due delivery. SKIP LOCKED => no double-claim across workers."""
    with conn.cursor() as cur:
        cur.execute(_CLAIM)
        row = cur.fetchone()
    return dict(row) if row else None


def record_success(conn: psycopg.Connection, delivery_id: str, provider_message_id: str) -> None:
    """Tx B (success): mark sent and store the provider id (acks arrive later via webhook)."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE deliveries SET status='sent', provider_message_id=%s, last_error=NULL, "
            "updated_at=now() WHERE id=%s AND status='sending'",
            (provider_message_id, delivery_id),
        )


def record_failure(
    conn: psycopg.Connection,
    delivery_id: str,
    error: str,
    *,
    exhausted: bool,
    delay_seconds: int,
) -> None:
    """Tx B (failure): needs_review if attempts exhausted, else re-queue with backoff."""
    with conn.cursor() as cur:
        if exhausted:
            cur.execute(
                "UPDATE deliveries SET status='needs_review', last_error=%s, updated_at=now() "
                "WHERE id=%s AND status='sending'",
                (error, delivery_id),
            )
        else:
            cur.execute(
                "UPDATE deliveries SET status='queued', last_error=%s, "
                "next_attempt_at = now() + make_interval(secs => %s), updated_at=now() "
                "WHERE id=%s AND status='sending'",
                (error, delay_seconds, delivery_id),
            )


def sweep_zombies(conn: psycopg.Connection, timeout_minutes: int) -> int:
    """Move deliveries stuck in 'sending' beyond the timeout to needs_review. Returns count."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE deliveries SET status='needs_review', "
            "last_error='zombie: sending exceeded timeout', updated_at=now() "
            "WHERE status='sending' AND claimed_at < now() - make_interval(mins => %s)",
            (timeout_minutes,),
        )
        return cur.rowcount


def simulate_ack(conn: psycopg.Connection, provider_message_id: str) -> None:
    """Demo helper (MockDispatcher): mark delivered + acknowledged, as if the recipient pressed 1."""  # noqa: E501
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE deliveries SET status='delivered', ack_status='acknowledged', "
            "ack_method='keypad', updated_at=now() WHERE provider_message_id=%s",
            (provider_message_id,),
        )
