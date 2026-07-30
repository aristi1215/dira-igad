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


def test_recipient_validation_and_soft_delete(
    api_client: TestClient,
    db_conn,
    first_zone_id: str,
) -> None:
    invalid = api_client.post(
        "/recipients",
        json={
            "name": "Invalid",
            "zone_id": first_zone_id,
            "phone_e164": "0700000000",
            "language": "sw",
            "channel": "voice",
        },
    )
    assert invalid.status_code == 422

    created = api_client.post(
        "/recipients",
        json={
            "name": "Integration recipient",
            "zone_id": first_zone_id,
            "phone_e164": "+254700000099",
            "language": "sw",
            "channel": "sms",
        },
    )
    assert created.status_code == 200
    recipient_id = created.json()["id"]

    deleted = api_client.delete(f"/recipients/{recipient_id}")
    assert deleted.status_code == 200
    assert deleted.json()["active"] is False
    with db_conn.cursor() as cur:
        cur.execute("SELECT active FROM recipients WHERE id = %s", (recipient_id,))
        assert cur.fetchone()["active"] is False


@pytest.mark.parametrize("status", ["approved", "dispatching"])
def test_alert_edit_requires_pending_approval(
    api_client: TestClient,
    make_alert,
    status: str,
) -> None:
    alert_id = make_alert(status=status)
    response = api_client.patch(
        f"/alerts/{alert_id}",
        json={"body_text": "Edited alert", "language": "sw"},
    )
    assert response.status_code == 409


def test_alert_edit_pending_approval(api_client: TestClient, make_alert) -> None:
    alert_id = make_alert(status="pending_approval")
    response = api_client.patch(
        f"/alerts/{alert_id}",
        json={"body_text": "Edited alert", "language": "en"},
    )
    assert response.status_code == 200
    assert response.json()["body_text"] == "Edited alert"
    assert response.json()["language"] == "en"


def test_advisor_dispatch_is_human_gated_and_queues_direct_numbers(
    api_client: TestClient,
    db_conn,
    make_situation,
) -> None:
    situation_id = make_situation()
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS count FROM deliveries WHERE alert_id IN "
            "(SELECT id FROM alerts WHERE situation_id = %s)",
            (situation_id,),
        )
        assert int(cur.fetchone()["count"]) == 0

    response = api_client.post(
        "/advisor/dispatch",
        json={
            "situation_id": str(situation_id),
            "phone_numbers": ["+254700000091", "+254700000092"],
            "channel": "voice",
            "approved_by": "Named operator",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "approved"
    assert payload["approved_by"] == "Named operator"
    assert payload["deliveries"] == 2

    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.status AS alert_status, a.approved_by,
                   d.status AS delivery_status, r.phone_e164
            FROM alerts a
            JOIN deliveries d ON d.alert_id = a.id
            JOIN recipients r ON r.id = d.recipient_id
            WHERE a.id = %s
            ORDER BY r.phone_e164
            """,
            (payload["alert_id"],),
        )
        rows = cur.fetchall()
    assert len(rows) == 2
    assert {row["phone_e164"] for row in rows} == {"+254700000091", "+254700000092"}
    assert all(row["alert_status"] == "approved" for row in rows)
    assert all(row["delivery_status"] == "queued" for row in rows)


def test_advisor_dispatch_expands_both_channel(
    api_client: TestClient,
    db_conn,
    make_situation,
) -> None:
    situation_id = make_situation()
    response = api_client.post(
        "/advisor/dispatch",
        json={
            "situation_id": str(situation_id),
            "phone_numbers": ["+254700000093"],
            "channel": "both",
            "approved_by": "Named operator",
        },
    )
    assert response.status_code == 200
    assert response.json()["deliveries"] == 2
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.channel, d.status
            FROM deliveries d
            WHERE d.alert_id = %s
            ORDER BY d.channel
            """,
            (response.json()["alert_id"],),
        )
        assert cur.fetchall() == [
            {"channel": "sms", "status": "queued"},
            {"channel": "voice", "status": "queued"},
        ]


def test_advisor_dispatch_validates_signer_and_phone(
    api_client: TestClient,
    make_situation,
) -> None:
    situation_id = make_situation()
    empty_signer = api_client.post(
        "/advisor/dispatch",
        json={
            "situation_id": str(situation_id),
            "phone_numbers": ["+254700000094"],
            "approved_by": "",
        },
    )
    assert empty_signer.status_code == 422
    bad_phone = api_client.post(
        "/advisor/dispatch",
        json={
            "situation_id": str(situation_id),
            "phone_numbers": ["0700000095"],
            "approved_by": "Named operator",
        },
    )
    assert bad_phone.status_code == 400
    assert "0700000095" in bad_phone.json()["detail"]


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


def test_approve_expands_both_channel(
    api_client: TestClient,
    db_conn,
    make_alert,
    first_zone_id: str,
) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel)
            VALUES ('Both integration', %s, '+254700000098', 'sw', 'both')
            RETURNING id
            """,
            (first_zone_id,),
        )
        recipient_id = cur.fetchone()["id"]
    db_conn.commit()
    alert_id = make_alert(zone_id=first_zone_id, status="pending_approval")

    response = api_client.post(
        f"/alerts/{alert_id}/approve",
        json={"approved_by": "reviewer"},
    )
    assert response.status_code == 200
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT channel
            FROM deliveries
            WHERE alert_id = %s AND recipient_id = %s
            ORDER BY channel
            """,
            (alert_id, recipient_id),
        )
        channels = [row["channel"] for row in cur.fetchall()]
    assert channels == ["sms", "voice"]
    with db_conn.cursor() as cur:
        cur.execute("UPDATE recipients SET active = FALSE WHERE id = %s", (recipient_id,))
    db_conn.commit()


def test_webhook_spoof_rejected(
    api_client: TestClient,
    db_conn,
    make_delivery,
) -> None:
    provider_message_id = "spoof-rejected"
    make_delivery(status="sent", provider_message_id=provider_message_id)

    response = api_client.post(
        "/webhooks/twilio/gather",
        json={"CallSid": provider_message_id, "Digits": "1"},
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
        "/webhooks/twilio/gather",
        json={"CallSid": provider_message_id, "Digits": "1"},
        headers=headers,
    )
    duplicate = api_client.post(
        "/webhooks/twilio/gather",
        json={"CallSid": provider_message_id, "Digits": "2"},
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
        "/webhooks/twilio/gather",
        json={"CallSid": provider_message_id, "Digits": digit},
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


class _InspectingSms:
    def __init__(self, conn: Any) -> None:
        self.conn = conn
        self.saw_idle_transaction = False
        self.body = ""

    def send(self, to_e164: str, body: str, idempotency_key: str) -> str:
        self.saw_idle_transaction = self.conn.info.transaction_status == TransactionStatus.IDLE
        self.body = body
        return "provider-sms"


def test_sms_delivery_uses_sms_channel(db_conn, make_delivery) -> None:
    delivery_id = make_delivery(status="queued")
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE deliveries SET channel = 'sms' WHERE id = %s",
            (delivery_id,),
        )
        cur.execute(
            """
            UPDATE alerts
            SET body_text = 'SMS body'
            WHERE id = (SELECT alert_id FROM deliveries WHERE id = %s)
            """,
            (delivery_id,),
        )
    db_conn.commit()
    sms = _InspectingSms(db_conn)
    voice = _InspectingVoice(db_conn)
    settings = WorkerSettings(database_url="postgresql://unused")

    assert process_one(
        db_conn,
        voice,
        settings,
        audio_fallback="file://fallback.wav",
        sms=sms,
    ) is True
    assert sms.saw_idle_transaction is True
    assert sms.body == "SMS body"
