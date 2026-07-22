from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from dira_core.ports import ProviderRef
from dira_worker.dispatch import (
    claim_next,
    process_one,
    record_failure,
    requeue_needs_review,
    sweep_zombies,
)
from dira_worker.settings import Settings as WorkerSettings
from fastapi.testclient import TestClient
from psycopg.pq import TransactionStatus

pytestmark = pytest.mark.integration

WEBHOOK_SECRET = "integration-secret"


@pytest.fixture()
def api_client(database_url: str, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from dira_api import main as api_main

    monkeypatch.setattr(
        api_main,
        "_settings",
        lambda: api_main.Settings(
            database_url=database_url,
            webhook_shared_secret=WEBHOOK_SECRET,
        ),
    )
    return TestClient(api_main.app)


def test_human_gate_unbypassable(api_client: TestClient, db_conn, make_alert) -> None:
    alert_id = make_alert(status="pending_approval")

    response = api_client.post(f"/alerts/{alert_id}/approve", json={})

    assert response.status_code == 422
    with db_conn.cursor() as cur:
        cur.execute("SELECT status FROM alerts WHERE id = %s", (alert_id,))
        assert cur.fetchone()["status"] == "pending_approval"


def test_approve_is_atomic(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dira_api import main as api_main

    alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")
    monkeypatch.setattr(api_main, "derive_idempotency_key", lambda *args: "collision")

    response = api_client.post(
        f"/alerts/{alert_id}/approve",
        json={"approved_by": "reviewer"},
        headers={"x-dira-user": "reviewer"},
    )

    assert response.status_code == 500
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT status, approved_by, approved_at FROM alerts WHERE id = %s",
            (alert_id,),
        )
        alert = cur.fetchone()
        cur.execute("SELECT count(*) AS count FROM deliveries WHERE alert_id = %s", (alert_id,))
        delivery_count = int(cur.fetchone()["count"])
    assert alert == {"status": "pending_approval", "approved_by": None, "approved_at": None}
    assert delivery_count == 0


def test_webhook_spoof_rejected(
    api_client: TestClient,
    db_conn,
    make_delivery,
) -> None:
    provider_message_id = "spoof-rejected"
    make_delivery(status="sent", provider_message_id=provider_message_id)

    response = api_client.post(
        "/webhooks/at/dtmf",
        json={"sessionId": provider_message_id, "dtmfDigits": "1"},
    )

    assert response.status_code == 403
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT ack_status FROM deliveries WHERE provider_message_id = %s",
            (provider_message_id,),
        )
        assert cur.fetchone()["ack_status"] == "none"


def test_webhook_duplicate_deduped(api_client: TestClient, db_conn, make_delivery) -> None:
    provider_message_id = "duplicate-dtmf"
    make_delivery(status="sent", provider_message_id=provider_message_id)
    headers = {"x-dira-webhook-secret": WEBHOOK_SECRET}

    first = api_client.post(
        "/webhooks/at/dtmf",
        json={"sessionId": provider_message_id, "dtmfDigits": "1"},
        headers=headers,
    )
    duplicate = api_client.post(
        "/webhooks/at/dtmf",
        json={"sessionId": provider_message_id, "dtmfDigits": "2"},
        headers=headers,
    )

    assert first.status_code == 200
    assert duplicate.status_code == 200
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT ack_status, ack_method, status FROM deliveries WHERE provider_message_id = %s",
            (provider_message_id,),
        )
        row = cur.fetchone()
    assert row == {"ack_status": "acknowledged", "ack_method": "dtmf_1", "status": "delivered"}


@pytest.mark.parametrize(
    ("digit", "ack_status", "ack_method", "delivery_status"),
    [
        ("1", "acknowledged", "dtmf_1", "delivered"),
        ("2", "conflict_reported", "dtmf_2", "sent"),
        ("3", "resolved", "dtmf_3", "sent"),
        ("9", "none", "dtmf_9", "sent"),
    ],
)
def test_dtmf_mapping(
    api_client: TestClient,
    db_conn,
    make_delivery,
    digit: str,
    ack_status: str,
    ack_method: str,
    delivery_status: str,
) -> None:
    provider_message_id = f"dtmf-{digit}"
    make_delivery(status="sent", provider_message_id=provider_message_id)

    response = api_client.post(
        "/webhooks/at/dtmf",
        json={"sessionId": provider_message_id, "dtmfDigits": digit},
        headers={"x-dira-webhook-secret": WEBHOOK_SECRET},
    )

    assert response.status_code == 200
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT ack_status, ack_method, status FROM deliveries WHERE provider_message_id = %s",
            (provider_message_id,),
        )
        row = cur.fetchone()
    assert row == {
        "ack_status": ack_status,
        "ack_method": ack_method,
        "status": delivery_status,
    }


def test_dispatch_crash_recovery(db_conn, make_delivery) -> None:
    delivery_id = make_delivery(status="queued")
    settings = WorkerSettings(
        database_url="postgresql://unused",
        zombie_timeout_minutes=10,
    )

    claimed = claim_next(db_conn)
    assert claimed is not None
    assert claimed["id"] == delivery_id
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE deliveries SET claimed_at = now() - INTERVAL '30 minutes' WHERE id = %s",
            (delivery_id,),
        )
    db_conn.commit()

    assert sweep_zombies(db_conn, settings) == 1
    with db_conn.cursor() as cur:
        cur.execute("SELECT status FROM deliveries WHERE id = %s", (delivery_id,))
        assert cur.fetchone()["status"] == "needs_review"

    requeue_needs_review(db_conn, delivery_id)
    with db_conn.cursor() as cur:
        cur.execute("SELECT status FROM deliveries WHERE id = %s", (delivery_id,))
        assert cur.fetchone()["status"] == "queued"


def test_backoff_and_exhaustion(db_conn, make_delivery) -> None:
    delivery_id = make_delivery(status="sending")
    settings = WorkerSettings(
        database_url="postgresql://unused",
        max_dispatch_attempts=2,
    )

    record_failure(db_conn, delivery_id, 0, "provider down", settings)
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT status, attempt_count, next_attempt_at FROM deliveries WHERE id = %s",
            (delivery_id,),
        )
        first = cur.fetchone()
    assert first["status"] == "queued"
    assert int(first["attempt_count"]) == 1
    assert first["next_attempt_at"] > datetime.now(UTC)

    record_failure(db_conn, delivery_id, 1, "provider still down", settings)
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT status, attempt_count, last_error FROM deliveries WHERE id = %s",
            (delivery_id,),
        )
        exhausted = cur.fetchone()
    assert exhausted == {
        "status": "needs_review",
        "attempt_count": 2,
        "last_error": "provider still down",
    }


def test_no_network_in_transaction(db_conn, make_delivery) -> None:
    make_delivery(status="queued")
    voice = _InspectingVoice(db_conn)
    settings = WorkerSettings(database_url="postgresql://unused")

    assert process_one(db_conn, voice, settings, audio_fallback="file://fallback.wav") is True

    assert voice.saw_idle_transaction is True
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, provider_message_id
            FROM deliveries
            WHERE provider_message_id = 'provider-no-open-tx'
            """
        )
        row = cur.fetchone()
    assert row == {"status": "sent", "provider_message_id": "provider-no-open-tx"}


class _InspectingVoice:
    def __init__(self, conn: Any) -> None:
        self.conn = conn
        self.saw_idle_transaction = False

    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef:
        self.saw_idle_transaction = self.conn.info.transaction_status == TransactionStatus.IDLE
        return ProviderRef(provider_message_id="provider-no-open-tx")
