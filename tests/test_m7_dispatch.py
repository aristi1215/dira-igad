"""M7 acceptance: crash recovery, no double-claim, backoff/exhaustion, no network in a Tx."""

from __future__ import annotations

import threading

import psycopg
import pytest
from dira_core.ports import ProviderRef
from dira_data import fixtures
from dira_data.repositories import dispatch as dq
from dira_data.repositories import geo
from dira_dispatch import MockDispatcher, backoff_seconds
from dira_worker.dispatch import process_one, run_cycle

pytestmark = pytest.mark.integration


def _setup(db: psycopg.Connection, n: int) -> str:
    geo.load_zones_geojson(db, fixtures.seeded_dir() / "zones.geojson")
    zone = "z_ke_mandera_town"
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO situations (zone_id, hazard_type, status) VALUES (%s,'conflict','open') "
            "RETURNING id",
            (zone,),
        )
        situation_id = cur.fetchone()["id"]
        # Approved alert (human gate satisfied with a signer).
        cur.execute(
            "INSERT INTO alerts (situation_id, status, draft_text, approved_by, approved_at) "
            "VALUES (%s,'approved','msg','analyst', now()) RETURNING id",
            (situation_id,),
        )
        alert_id = cur.fetchone()["id"]
        for i in range(n):
            cur.execute(
                "INSERT INTO recipients (zone_id, phone) VALUES (%s, %s) RETURNING id",
                (zone, f"+254700{i:06d}"),
            )
            rid = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO deliveries (alert_id, recipient_id, status, idempotency_key) "
                "VALUES (%s,%s,'queued',%s)",
                (alert_id, rid, f"key-{i}"),
            )
    return str(alert_id)


def test_dispatch_crash_recovery(db: psycopg.Connection) -> None:
    _setup(db, 1)
    claimed = dq.claim_one(db)  # Tx A
    assert claimed is not None
    with db.cursor() as cur:
        cur.execute("SELECT status FROM deliveries WHERE id=%s", (claimed["id"],))
        assert cur.fetchone()["status"] == "sending"
        # Simulate a crash before the provider call / Tx B: age the claim.
        cur.execute(
            "UPDATE deliveries SET claimed_at = now() - interval '20 minutes' WHERE id=%s",
            (claimed["id"],),
        )
    assert dq.sweep_zombies(db, 10) == 1
    with db.cursor() as cur:
        cur.execute("SELECT status FROM deliveries WHERE id=%s", (claimed["id"],))
        assert cur.fetchone()["status"] == "needs_review"
        # No non-terminal delivery is invisible: it is reachable via the queue or needs_review.
        cur.execute(
            "SELECT count(*) c FROM deliveries WHERE status='sending' "
            "AND claimed_at < now() - interval '10 minutes'"
        )
        assert cur.fetchone()["c"] == 0
    # Manual retry re-queues it; a working dispatcher then sends it.
    with db.cursor() as cur:
        cur.execute(
            "UPDATE deliveries SET status='queued', next_attempt_at=now() "
            "WHERE id=%s AND status='needs_review'",
            (claimed["id"],),
        )
    process_one(db, MockDispatcher(), max_attempts=5)
    with db.cursor() as cur:
        cur.execute("SELECT status FROM deliveries WHERE id=%s", (claimed["id"],))
        assert cur.fetchone()["status"] in ("sent", "delivered")


def test_two_dispatchers_no_double_claim(db: psycopg.Connection, db_url: str) -> None:
    _setup(db, 20)
    results: dict[int, list[str]] = {0: [], 1: []}

    def worker(idx: int) -> None:
        from dira_data.db import connect

        conn = connect(db_url, autocommit=True)
        try:
            while True:
                d = dq.claim_one(conn)
                if d is None:
                    break
                results[idx].append(str(d["id"]))
        finally:
            conn.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in (0, 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    all_ids = results[0] + results[1]
    assert len(all_ids) == 20  # every row claimed
    assert len(set(all_ids)) == 20  # each exactly once (SKIP LOCKED)
    assert not (set(results[0]) & set(results[1]))


def test_backoff_and_exhaustion(db: psycopg.Connection) -> None:
    _setup(db, 1)

    class FailingChannel:
        def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef:
            raise RuntimeError("provider down")

    channel = FailingChannel()
    for attempt in range(1, 6):  # max_attempts = 5
        # Make the delivery due again (undo the backoff push) before each pass.
        with db.cursor() as cur:
            cur.execute("UPDATE deliveries SET next_attempt_at = now() WHERE status='queued'")
        assert process_one(db, channel, max_attempts=5) is True
        with db.cursor() as cur:
            cur.execute("SELECT status, attempts FROM deliveries LIMIT 1")
            row = cur.fetchone()
        if attempt < 5:
            assert row["status"] == "queued" and row["attempts"] == attempt
        else:
            assert row["status"] == "needs_review" and row["attempts"] == 5

    # Backoff schedule is the documented 1m/5m/25m/2h.
    assert [backoff_seconds(a) for a in (1, 2, 3, 4, 5)] == [60, 300, 1500, 7200, 7200]


def test_no_network_in_transaction(db: psycopg.Connection) -> None:
    _setup(db, 1)

    class ProbeChannel:
        def __init__(self, conn: psycopg.Connection) -> None:
            self.conn = conn
            self.checked = False

        def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef:
            # No transaction may be open when the provider is called (invariant 5).
            assert self.conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
            self.checked = True
            return ProviderRef(provider_message_id="probe-pid")

    probe = ProbeChannel(db)
    process_one(db, probe, max_attempts=5)
    assert probe.checked


def test_mock_dispatcher_full_cycle_to_green(db: psycopg.Connection) -> None:
    _setup(db, 2)
    processed = run_cycle(db, MockDispatcher(), max_attempts=5, timeout_minutes=10)
    assert processed == 2
    with db.cursor() as cur:
        cur.execute("SELECT status, ack_status FROM deliveries")
        rows = cur.fetchall()
    # MockDispatcher simulated the ack -> delivered + acknowledged (map turns green).
    assert all(r["status"] == "delivered" and r["ack_status"] == "acknowledged" for r in rows)
