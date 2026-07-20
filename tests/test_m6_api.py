"""M6 acceptance: human gate, atomic approval, webhook spoof/dedup/DTMF mapping, SSE relay."""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime

import psycopg
import pytest
from dira_api.main import app
from dira_data import fixtures
from dira_data.repositories import alerts as alerts_repo
from dira_data.repositories import geo
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


@pytest.fixture
def client() -> TestClient:
    # raise_server_exceptions=False so an injected 500 is returned, not re-raised (atomicity test).
    return TestClient(app, raise_server_exceptions=False)


def _make_case(db: psycopg.Connection) -> dict[str, str]:
    """Zones + a red situation + assessment + recipients + one delivery with a provider id."""
    geo.load_zones_geojson(db, fixtures.seeded_dir() / "zones.geojson")
    geo.upsert_exposure(db, fixtures.load_json("exposure.json"))
    geo.upsert_recipients(db, fixtures.load_json("recipients.json"))
    zone = "z_ke_mandera_town"
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO situations (zone_id, hazard_type, status) VALUES (%s,'conflict','open') "
            "RETURNING id",
            (zone,),
        )
        situation_id = str(cur.fetchone()["id"])
        cur.execute(
            "INSERT INTO assessments (situation_id, cycle, data_cutoff, prob_conflict, "
            "expected_incidents, model_risk, model_band, corroboration, operational_band, "
            "combination_rule, explanation, shap) VALUES "
            "(%s, %s, %s, 0.9, 4.5, 0.9, 'red', 0.0, 'red', 'rule', 'why', '{}'::jsonb) "
            "RETURNING id",
            (situation_id, date(2026, 1, 1), datetime(2026, 1, 1, tzinfo=UTC)),
        )
        assessment_id = str(cur.fetchone()["id"])
        cur.execute(
            "INSERT INTO exposure_snapshots (assessment_id, population, households) "
            "VALUES (%s, 50000, 10000)",
            (assessment_id,),
        )
    return {"situation_id": situation_id, "zone": zone}


def test_map_situations_geojson(client: TestClient, db: psycopg.Connection) -> None:
    _make_case(db)
    resp = client.get("/map/situations")
    assert resp.status_code == 200
    fc = resp.json()
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 1
    assert fc["features"][0]["geometry"]["type"] in ("Polygon", "MultiPolygon")


def test_human_gate_unbypassable(client: TestClient, db: psycopg.Connection) -> None:
    case = _make_case(db)
    # (1) A direct UPDATE to approved without a signer is rejected by the DB CHECK.
    draft = client.post(f"/situations/{case['situation_id']}/alert", json={}).json()
    with pytest.raises(psycopg.errors.CheckViolation):
        with db.cursor() as cur:
            cur.execute("UPDATE alerts SET status='approved' WHERE id=%s", (draft["id"],))
    # (2) The endpoint without an approver is a 422 (approver required).
    resp = client.post(f"/alerts/{draft['id']}/approve", json={})
    assert resp.status_code == 422


def test_approve_is_atomic(client: TestClient, db: psycopg.Connection, monkeypatch) -> None:
    case = _make_case(db)
    draft = client.post(f"/situations/{case['situation_id']}/alert", json={}).json()

    calls = {"n": 0}
    real = alerts_repo.insert_delivery

    def flaky(conn, alert_id, recipient_id, channel="voice"):
        calls["n"] += 1
        if calls["n"] == 2:  # fail before the last delivery
            raise RuntimeError("injected delivery failure")
        return real(conn, alert_id, recipient_id, channel)

    monkeypatch.setattr(alerts_repo, "insert_delivery", flaky)
    resp = client.post(f"/alerts/{draft['id']}/approve", json={"approved_by": "analyst"})
    assert resp.status_code == 500
    # Rollback: alert still pending, zero deliveries.
    with db.cursor() as cur:
        cur.execute("SELECT status, approved_by FROM alerts WHERE id=%s", (draft["id"],))
        alert = cur.fetchone()
        assert alert["status"] == "pending_approval" and alert["approved_by"] is None
        cur.execute("SELECT count(*) c FROM deliveries WHERE alert_id=%s", (draft["id"],))
        assert cur.fetchone()["c"] == 0


def test_approve_creates_all_deliveries_and_second_approve_conflicts(
    client: TestClient, db: psycopg.Connection
) -> None:
    case = _make_case(db)
    draft = client.post(f"/situations/{case['situation_id']}/alert", json={}).json()
    resp = client.post(f"/alerts/{draft['id']}/approve", json={"approved_by": "analyst"})
    assert resp.status_code == 200
    # Two active recipients live in Mandera Town.
    assert resp.json()["deliveries_created"] == 2
    # Concurrent/second approval fails cleanly.
    resp2 = client.post(f"/alerts/{draft['id']}/approve", json={"approved_by": "analyst"})
    assert resp2.status_code == 409


def _delivery_with_provider(db: psycopg.Connection, case: dict, session_id: str) -> str:
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO alerts (situation_id, status, draft_text) "
            "VALUES (%s,'pending_approval','x') RETURNING id",
            (case["situation_id"],),
        )
        alert_id = cur.fetchone()["id"]
        cur.execute("SELECT id FROM recipients LIMIT 1")
        rid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO deliveries (alert_id, recipient_id, status, idempotency_key, "
            "provider_message_id) VALUES (%s,%s,'sent',%s,%s) RETURNING id",
            (alert_id, rid, f"key-{session_id}", session_id),
        )
        return str(cur.fetchone()["id"])


def test_webhook_spoof_rejected(client: TestClient, db: psycopg.Connection) -> None:
    case = _make_case(db)
    _delivery_with_provider(db, case, "SESSION-REAL")
    resp = client.post("/webhooks/at/dtmf", json={"sessionId": "UNKNOWN", "dtmfDigits": "1"})
    assert resp.status_code == 200 and resp.json()["applied"] is False
    with db.cursor() as cur:
        cur.execute("SELECT count(*) c FROM deliveries WHERE ack_status <> 'none'")
        assert cur.fetchone()["c"] == 0


def test_dtmf_mapping(client: TestClient, db: psycopg.Connection) -> None:
    case = _make_case(db)
    for digit, expected in (("1", "acknowledged"), ("2", "need_help"), ("3", "not_affected")):
        sid = f"SESS-{digit}"
        did = _delivery_with_provider(db, case, sid)
        client.post("/webhooks/at/dtmf", json={"sessionId": sid, "dtmfDigits": digit})
        with db.cursor() as cur:
            cur.execute("SELECT ack_status, ack_method FROM deliveries WHERE id=%s", (did,))
            row = cur.fetchone()
        assert row["ack_status"] == expected and row["ack_method"] == "keypad"
    # '9' = replay: ack_method recorded, ack_status stays 'none'.
    sid9 = "SESS-9"
    did9 = _delivery_with_provider(db, case, sid9)
    client.post("/webhooks/at/dtmf", json={"sessionId": sid9, "dtmfDigits": "9"})
    with db.cursor() as cur:
        cur.execute("SELECT ack_status, ack_method FROM deliveries WHERE id=%s", (did9,))
        row = cur.fetchone()
    assert row["ack_status"] == "none" and row["ack_method"] == "keypad"


def test_webhook_duplicate_deduped(client: TestClient, db: psycopg.Connection) -> None:
    case = _make_case(db)
    _delivery_with_provider(db, case, "SESS-DUP")
    first = client.post("/webhooks/at/status", json={"id": "SESS-DUP", "status": "Success"})
    second = client.post("/webhooks/at/status", json={"id": "SESS-DUP", "status": "Success"})
    assert first.json()["applied"] is True
    assert second.json()["applied"] is False  # duplicate is a no-op (one state change)
    with db.cursor() as cur:
        cur.execute("SELECT status FROM deliveries WHERE provider_message_id='SESS-DUP'")
        assert cur.fetchone()["status"] == "delivered"


async def test_sse_relays_notify(db: psycopg.Connection, db_url: str) -> None:
    """A delivery UPDATE reaches the SSE relay as an event in < 2s (LISTEN/NOTIFY layer)."""
    from dira_api.sse import _listen

    case = _make_case(db)
    did = _delivery_with_provider(db, case, "SESS-SSE")

    agen = _listen().__aiter__()
    next_event = asyncio.create_task(agen.__anext__())
    await asyncio.sleep(0.5)  # let the dedicated LISTEN connection attach
    # Mutate a delivery -> trigger fires pg_notify('dira_events', ...).
    with psycopg.connect(db_url, autocommit=True) as w:
        w.execute("UPDATE deliveries SET status='delivered' WHERE id=%s", (did,))
    event = await asyncio.wait_for(next_event, timeout=2.0)
    assert event["event"] == "dira" and "delivered" in event["data"]
    await agen.aclose()
