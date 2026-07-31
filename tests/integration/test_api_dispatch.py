from __future__ import annotations

import hashlib
import secrets
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


def _active_recipients(db_conn, zone_id: str) -> list[dict[str, Any]]:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, phone_e164 FROM recipients
            WHERE active = TRUE AND zone_id = %s
            ORDER BY created_at
            """,
            (zone_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def _delivery_recipient_ids(db_conn, alert_id) -> set:
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT recipient_id FROM deliveries WHERE alert_id = %s",
            (alert_id,),
        )
        return {row["recipient_id"] for row in cur.fetchall()}


def test_default_recipients_endpoint_annotates_why_each_matched(
    api_client: TestClient,
    make_alert,
    zone_with_recipients: str,
) -> None:
    """The screen must render the server's targeting rule, not its own copy."""
    alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")

    response = api_client.get(f"/alerts/{alert_id}/recipients")

    assert response.status_code == 200
    rows = response.json()
    assert rows, "seed data should give this zone recipients"
    assert {row["match_reason"] for row in rows} <= {"zone match", "all zones"}
    # Deduped by phone: one row per person, whatever the roster looks like.
    phones = [row["phone_e164"] for row in rows]
    assert len(phones) == len(set(phones))


def test_approve_queues_only_the_selected_recipients(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    recipients = _active_recipients(db_conn, zone_with_recipients)
    assert len(recipients) >= 2
    chosen = recipients[0]
    alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")

    response = api_client.post(
        f"/alerts/{alert_id}/approve",
        json={"approved_by": "reviewer", "recipient_ids": [str(chosen["id"])]},
    )

    assert response.status_code == 200
    assert response.json()["recipients"] == 1
    assert _delivery_recipient_ids(db_conn, alert_id) == {chosen["id"]}


def test_approve_accepts_a_recipient_outside_the_alert_zone(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    """Pulling in a neighbouring contact is a main reason selection exists."""
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM zones WHERE id <> %s ORDER BY id LIMIT 1",
            (zone_with_recipients,),
        )
        other_zone = cur.fetchone()["id"]
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel)
            VALUES ('Neighbour', %s, %s, 'sw', 'voice')
            RETURNING id
            """,
            (other_zone, f"+2547{secrets.randbelow(10**8):08d}"),
        )
        outsider = cur.fetchone()["id"]
    db_conn.commit()

    try:
        alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")
        response = api_client.post(
            f"/alerts/{alert_id}/approve",
            json={"approved_by": "reviewer", "recipient_ids": [str(outsider)]},
        )

        assert response.status_code == 200
        assert _delivery_recipient_ids(db_conn, alert_id) == {outsider}
    finally:
        with db_conn.cursor() as cur:
            cur.execute("UPDATE recipients SET active = FALSE WHERE id = %s", (outsider,))
        db_conn.commit()


def test_approve_rejects_an_empty_selection(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    """Approving something that queues nothing is never the intent."""
    alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")

    response = api_client.post(
        f"/alerts/{alert_id}/approve",
        json={"approved_by": "reviewer", "recipient_ids": []},
    )

    assert response.status_code == 422
    assert "Reject the alert instead" in response.json()["detail"]
    with db_conn.cursor() as cur:
        cur.execute("SELECT status FROM alerts WHERE id = %s", (alert_id,))
        assert cur.fetchone()["status"] == "pending_approval"


def test_approve_rejects_inactive_and_unknown_recipients(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel, active)
            VALUES ('Retired contact', %s, %s, 'sw', 'voice', FALSE)
            RETURNING id
            """,
            (zone_with_recipients, f"+2547{secrets.randbelow(10**8):08d}"),
        )
        inactive_id = cur.fetchone()["id"]
    db_conn.commit()

    alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")
    inactive = api_client.post(
        f"/alerts/{alert_id}/approve",
        json={"approved_by": "reviewer", "recipient_ids": [str(inactive_id)]},
    )
    assert inactive.status_code == 422
    assert "Retired contact" in inactive.json()["detail"]

    unknown_id = "00000000-0000-0000-0000-0000000000ff"
    unknown = api_client.post(
        f"/alerts/{alert_id}/approve",
        json={"approved_by": "reviewer", "recipient_ids": [unknown_id]},
    )
    assert unknown.status_code == 422
    assert unknown_id in unknown.json()["detail"]

    # Neither rejection may have moved the alert off the gate.
    with db_conn.cursor() as cur:
        cur.execute("SELECT status FROM alerts WHERE id = %s", (alert_id,))
        assert cur.fetchone()["status"] == "pending_approval"


def test_approve_records_the_body_the_approver_read(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    body = "Tahadhari mahsusi ya ukaguzi."
    alert_id = make_alert(
        zone_id=zone_with_recipients, status="pending_approval", body_text=body
    )

    api_client.post(f"/alerts/{alert_id}/approve", json={"approved_by": "reviewer"})

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT approved_body_sha256 FROM alerts WHERE id = %s", (alert_id,)
        )
        stored = cur.fetchone()["approved_body_sha256"]
    assert stored == hashlib.sha256(body.encode("utf-8")).hexdigest()


def test_reject_closes_the_gate_without_queueing_anything(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")

    response = api_client.post(
        f"/alerts/{alert_id}/reject",
        json={"rejected_by": "reviewer", "reason": "Duplicate of this morning's alert"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT status, rejected_by, rejection_reason FROM alerts WHERE id = %s",
            (alert_id,),
        )
        alert = dict(cur.fetchone())
        cur.execute(
            "SELECT count(*) AS count FROM deliveries WHERE alert_id = %s", (alert_id,)
        )
        assert int(cur.fetchone()["count"]) == 0
    assert alert["rejected_by"] == "reviewer"
    assert alert["rejection_reason"] == "Duplicate of this morning's alert"

    # Rejection is terminal — a declined alert cannot be quietly approved later.
    second = api_client.post(
        f"/alerts/{alert_id}/approve", json={"approved_by": "someone else"}
    )
    assert second.status_code == 409
    assert "rejected" in second.json()["detail"]


def test_reject_requires_a_pending_alert(
    api_client: TestClient,
    make_alert,
    zone_with_recipients: str,
) -> None:
    approved = make_alert(zone_id=zone_with_recipients, status="approved")

    response = api_client.post(
        f"/alerts/{approved}/reject", json={"rejected_by": "reviewer"}
    )

    assert response.status_code == 409


def _add_variant(db_conn, alert_id, language: str, body: str, role: str | None = None):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO alert_variants (alert_id, language, role, body_text, source)
            VALUES (%s, %s, %s, %s, 'human_authored')
            RETURNING id
            """,
            (alert_id, language, role, body),
        )
        variant_id = cur.fetchone()["id"]
    db_conn.commit()
    return variant_id


def test_delivery_carries_the_variant_for_the_recipients_language(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    """A Somali contact must not receive the Swahili body."""
    somali_body = "Digniin: khatarta ayaa kordheysa."
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel)
            VALUES ('Somali contact', %s, %s, 'so', 'voice')
            RETURNING id
            """,
            (zone_with_recipients, f"+2547{secrets.randbelow(10**8):08d}"),
        )
        somali_id = cur.fetchone()["id"]
    db_conn.commit()

    try:
        alert_id = make_alert(
            zone_id=zone_with_recipients,
            status="pending_approval",
            body_text="Tahadhari ya Kiswahili.",
        )
        _add_variant(db_conn, alert_id, "so", somali_body)

        response = api_client.post(
            f"/alerts/{alert_id}/approve",
            json={"approved_by": "reviewer", "recipient_ids": [str(somali_id)]},
        )
        assert response.status_code == 200

        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT body_text FROM deliveries WHERE alert_id = %s AND recipient_id = %s",
                (alert_id, somali_id),
            )
            assert cur.fetchone()["body_text"] == somali_body
    finally:
        with db_conn.cursor() as cur:
            cur.execute("UPDATE recipients SET active = FALSE WHERE id = %s", (somali_id,))
        db_conn.commit()


def test_a_role_variant_reaches_only_that_role(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel, role)
            VALUES ('Livestock officer', %s, %s, 'sw', 'voice', 'livestock_officer')
            RETURNING id
            """,
            (zone_with_recipients, f"+2547{secrets.randbelow(10**8):08d}"),
        )
        officer_id = cur.fetchone()["id"]
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel, role)
            VALUES ('Village chief', %s, %s, 'sw', 'voice', 'chief')
            RETURNING id
            """,
            (zone_with_recipients, f"+2547{secrets.randbelow(10**8):08d}"),
        )
        chief_id = cur.fetchone()["id"]
    db_conn.commit()

    try:
        alert_id = make_alert(
            zone_id=zone_with_recipients,
            status="pending_approval",
            body_text="Tahadhari ya jumla.",
        )
        _add_variant(db_conn, alert_id, "sw", "Hamisha mifugo.", role="livestock_officer")

        api_client.post(
            f"/alerts/{alert_id}/approve",
            json={
                "approved_by": "reviewer",
                "recipient_ids": [str(officer_id), str(chief_id)],
            },
        )

        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT recipient_id, body_text FROM deliveries WHERE alert_id = %s",
                (alert_id,),
            )
            bodies = {row["recipient_id"]: row["body_text"] for row in cur.fetchall()}
        assert bodies[officer_id] == "Hamisha mifugo."
        assert bodies[chief_id] == "Tahadhari ya jumla."
    finally:
        with db_conn.cursor() as cur:
            cur.execute(
                "UPDATE recipients SET active = FALSE WHERE id = ANY(%s)",
                ([officer_id, chief_id],),
            )
        db_conn.commit()


def test_variant_upsert_and_first_edit_preserves_the_ai_draft(
    api_client: TestClient,
    make_alert,
    zone_with_recipients: str,
) -> None:
    alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")

    created = api_client.post(
        f"/alerts/{alert_id}/variants",
        json={"language": "en", "body_text": "Original wording."},
    )
    assert created.status_code == 200
    variant_id = created.json()["id"]
    assert created.json()["source"] == "human_authored"

    # The unique index is on COALESCE(role, ''), so a second role-less variant
    # for the same language must update rather than duplicate.
    again = api_client.post(
        f"/alerts/{alert_id}/variants",
        json={"language": "en", "body_text": "Replaced wording."},
    )
    assert again.status_code == 200
    assert again.json()["id"] == variant_id
    assert len(api_client.get(f"/alerts/{alert_id}/variants").json()) == 1

    first_edit = api_client.patch(
        f"/alert-variants/{variant_id}", json={"body_text": "Edited once."}
    )
    assert first_edit.json()["source"] == "human_edited"
    assert first_edit.json()["llm_draft"] == "Replaced wording."

    second_edit = api_client.patch(
        f"/alert-variants/{variant_id}", json={"body_text": "Edited twice."}
    )
    # Still the original — a second keystroke must not eat the draft.
    assert second_edit.json()["llm_draft"] == "Replaced wording."

    assert api_client.delete(f"/alert-variants/{variant_id}").status_code == 200
    assert api_client.get(f"/alerts/{alert_id}/variants").json() == []


def test_recipients_endpoint_flags_who_falls_through_to_the_default(
    api_client: TestClient,
    db_conn,
    make_alert,
    zone_with_recipients: str,
) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel)
            VALUES ('Amharic contact', %s, %s, 'am', 'voice')
            RETURNING id
            """,
            (zone_with_recipients, f"+2547{secrets.randbelow(10**8):08d}"),
        )
        amharic_id = cur.fetchone()["id"]
    db_conn.commit()

    try:
        alert_id = make_alert(zone_id=zone_with_recipients, status="pending_approval")
        rows = api_client.get(f"/alerts/{alert_id}/recipients").json()
        amharic = next(row for row in rows if row["id"] == str(amharic_id))

        # No Amharic variant exists, so this contact gets the alert body — the
        # point is that the screen is told, not that it silently happens.
        assert amharic["variant_is_fallback"] is True
        assert amharic["variant_match"] == "default"
    finally:
        with db_conn.cursor() as cur:
            cur.execute("UPDATE recipients SET active = FALSE WHERE id = %s", (amharic_id,))
        db_conn.commit()


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
    # A fixed phone number made this test depend on its own leftovers: every
    # failed run left another active row behind, and the fan-out now dedupes by
    # phone, so the row under test could lose to one from a previous run.
    phone = f"+2547{secrets.randbelow(10**8):08d}"
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO recipients (name, zone_id, phone_e164, language, channel)
            VALUES ('Both integration', %s, %s, 'sw', 'both')
            RETURNING id
            """,
            (first_zone_id, phone),
        )
        recipient_id = cur.fetchone()["id"]
    db_conn.commit()

    try:
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
    finally:
        with db_conn.cursor() as cur:
            cur.execute(
                "UPDATE recipients SET active = FALSE WHERE id = %s", (recipient_id,)
            )
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
        self.language: str | None = None

    def call(
        self,
        phone: str,
        audio_url: str,
        idem_key: str,
        *,
        language: str = "sw",
    ) -> ProviderRef:
        self.saw_idle_transaction = self.conn.info.transaction_status == TransactionStatus.IDLE
        self.language = language
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


def test_dispatch_sends_the_snapshot_not_the_alert_body(db_conn, make_delivery) -> None:
    """The wording frozen at approval is what goes out.

    If the worker re-read `alerts.body_text` at dispatch time, an edit landing
    after approval would change what recipients hear without anyone approving
    the new text.
    """
    delivery_id = make_delivery(status="queued")
    with db_conn.cursor() as cur:
        cur.execute(
            """
            UPDATE deliveries SET channel = 'sms', body_text = 'What was approved'
            WHERE id = %s
            """,
            (delivery_id,),
        )
        cur.execute(
            """
            UPDATE alerts SET body_text = 'Edited afterwards'
            WHERE id = (SELECT alert_id FROM deliveries WHERE id = %s)
            """,
            (delivery_id,),
        )
    db_conn.commit()
    sms = _InspectingSms(db_conn)
    settings = WorkerSettings(database_url="postgresql://unused")

    process_one(
        db_conn,
        _InspectingVoice(db_conn),
        settings,
        audio_fallback="file://fallback.wav",
        sms=sms,
    )

    assert sms.body == "What was approved"


def test_voice_dispatch_uses_the_alert_language(db_conn, make_delivery) -> None:
    """The language chosen at the gate has to reach the provider."""
    delivery_id = make_delivery(status="queued")
    with db_conn.cursor() as cur:
        cur.execute(
            """
            UPDATE alerts SET language = 'en'
            WHERE id = (SELECT alert_id FROM deliveries WHERE id = %s)
            """,
            (delivery_id,),
        )
    db_conn.commit()
    voice = _InspectingVoice(db_conn)

    process_one(
        db_conn,
        voice,
        WorkerSettings(database_url="postgresql://unused"),
        audio_fallback="file://fallback.wav",
    )

    assert voice.language == "en"
