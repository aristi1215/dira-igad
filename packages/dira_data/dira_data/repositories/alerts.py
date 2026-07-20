"""Alert + delivery repository: draft creation, the durable-promise approval transaction,
and webhook handlers. The human gate is enforced by the DB CHECK; this code never bypasses it.
"""

from __future__ import annotations

from typing import Any

import psycopg
from dira_core import AckStatus, derive_idempotency_key


class ApprovalConflict(Exception):
    """The alert was not in pending_approval (already approved, or a concurrent approval won)."""


def create_draft(
    conn: psycopg.Connection, situation_id: str, draft_text: str, language: str = "sw"
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO alerts (situation_id, status, draft_text, language) "
            "VALUES (%s, 'pending_approval', %s, %s) "
            "RETURNING id::text AS id, status, draft_text, language",
            (situation_id, draft_text, language),
        )
        return dict(cur.fetchone())


def insert_delivery(
    conn: psycopg.Connection, alert_id: str, recipient_id: str, channel: str = "voice"
) -> None:
    """Insert one queued delivery with the deterministic idempotency key (invariant 4)."""
    idem = derive_idempotency_key(alert_id, recipient_id, channel)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO deliveries (alert_id, recipient_id, channel, status, idempotency_key) "
            "VALUES (%s, %s, %s, 'queued', %s)",
            (alert_id, recipient_id, channel, idem),
        )


def approve_alert(conn: psycopg.Connection, alert_id: str, approved_by: str) -> int:
    """Durable-promise transaction (DIRA-SPEC §5.1): approve + insert ALL deliveries atomically.

    Either the alert becomes approved AND every active recipient gets a queued delivery, or
    nothing changes. A concurrent second approval fails cleanly (ApprovalConflict).
    """
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE alerts SET status='approved', approved_by=%s, approved_at=now(), "
                "updated_at=now() WHERE id=%s AND status='pending_approval' "
                "RETURNING situation_id",
                (approved_by, alert_id),
            )
            row = cur.fetchone()
            if row is None:
                raise ApprovalConflict(f"alert {alert_id} is not pending_approval")
            cur.execute("SELECT zone_id FROM situations WHERE id=%s", (row["situation_id"],))
            zone_id = cur.fetchone()["zone_id"]
            cur.execute(
                "SELECT id FROM recipients WHERE zone_id=%s AND active ORDER BY id", (zone_id,)
            )
            recipient_ids = [r["id"] for r in cur.fetchall()]
        count = 0
        for rid in recipient_ids:
            insert_delivery(conn, alert_id, str(rid))
            count += 1
    return count


# --- Webhooks -----------------------------------------------------------------------------
_DTMF_MAP = {
    "1": AckStatus.ACKNOWLEDGED,
    "2": AckStatus.NEED_HELP,
    "3": AckStatus.NOT_AFFECTED,
}


def handle_dtmf(conn: psycopg.Connection, session_id: str, digit: str) -> bool:
    """Apply a DTMF acknowledgement. Unknown session -> no mutation. Returns True if applied."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, ack_status FROM deliveries WHERE provider_message_id=%s",
                    (session_id,))
        row = cur.fetchone()
        if row is None:
            return False  # spoofed/unknown session — accept (200) but mutate nothing
        if digit == "9":
            # Replay request: record the method, ack_status stays 'none'.
            cur.execute(
                "UPDATE deliveries SET ack_method='keypad', updated_at=now() WHERE id=%s",
                (row["id"],),
            )
            return True
        ack = _DTMF_MAP.get(digit)
        if ack is None:
            return False
        cur.execute(
            "UPDATE deliveries SET ack_status=%s, ack_method='keypad', updated_at=now() "
            "WHERE id=%s",
            (ack.value, row["id"]),
        )
        return True


def handle_status(conn: psycopg.Connection, provider_message_id: str, status: str) -> bool:
    """Apply a provider delivery-status callback. Idempotent: a duplicate is a no-op.

    Returns True only when the status actually changed (dedup via provider_message_id UNIQUE).
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id, status FROM deliveries WHERE provider_message_id=%s",
                    (provider_message_id,))
        row = cur.fetchone()
        if row is None or row["status"] == status:
            return False
        cur.execute(
            "UPDATE deliveries SET status=%s, updated_at=now() WHERE id=%s", (status, row["id"])
        )
        return True
