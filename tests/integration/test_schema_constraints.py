from __future__ import annotations

from datetime import UTC, datetime

import psycopg
import pytest

pytestmark = pytest.mark.integration


def test_named_constraints_indexes_and_triggers_exist(db_conn) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT conname
            FROM pg_constraint
            WHERE conname = ANY(%s)
            """,
            (
                [
                    "alerts_human_gate_chk",
                    "zone_climate_dekad_day_chk",
                    "deliveries_idempotency_key_uq",
                    "uq_assessment_per_cycle",
                ],
            ),
        )
        constraints = {row["conname"] for row in cur.fetchall()}

        cur.execute(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = ANY(%s)
            """,
            (
                [
                    "uq_assessment_zone_cycle",
                    "situations_one_open_per_zone_hazard",
                ],
            ),
        )
        indexes = {row["indexname"] for row in cur.fetchall()}

        cur.execute(
            """
            SELECT trigger_name
            FROM information_schema.triggers
            WHERE trigger_schema = 'public' AND trigger_name = ANY(%s)
            """,
            (["alerts_notify", "situations_notify", "deliveries_notify"],),
        )
        triggers = {row["trigger_name"] for row in cur.fetchall()}

    assert constraints == {
        "alerts_human_gate_chk",
        "zone_climate_dekad_day_chk",
        "deliveries_idempotency_key_uq",
        "uq_assessment_per_cycle",
    }
    assert indexes == {"uq_assessment_zone_cycle", "situations_one_open_per_zone_hazard"}
    assert triggers == {"alerts_notify", "situations_notify", "deliveries_notify"}


def test_human_gate_unbypassable(db_conn, make_alert) -> None:
    alert_id = make_alert(status="pending_approval")

    with pytest.raises(psycopg.IntegrityError):
        with db_conn.cursor() as cur:
            cur.execute("UPDATE alerts SET status = 'approved' WHERE id = %s", (alert_id,))
        db_conn.commit()
    db_conn.rollback()

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT status, approved_by, approved_at FROM alerts WHERE id = %s",
            (alert_id,),
        )
        row = cur.fetchone()
    assert row == {"status": "pending_approval", "approved_by": None, "approved_at": None}


def test_dekad_day_15_rejected(db_conn, first_zone_id) -> None:
    with pytest.raises(psycopg.IntegrityError):
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO zone_climate_dekadal (
                  zone_id, dekad_start, rain_mm, rain_available_at
                )
                VALUES (%s, DATE '2035-01-15', 4.2, %s)
                """,
                (first_zone_id, datetime.now(UTC)),
            )
        db_conn.commit()
    db_conn.rollback()
