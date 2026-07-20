"""M0 acceptance: the schema carries the structural invariants (CHECKs, UNIQUEs, triggers)."""

from __future__ import annotations

import psycopg
import pytest

pytestmark = pytest.mark.integration


def _constraint_defs(conn: psycopg.Connection, table: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT pg_get_constraintdef(c.oid) AS def
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = %s
            """,
            (table,),
        )
        return [r["def"] for r in cur.fetchall()]


def test_human_gate_check_exists(db: psycopg.Connection) -> None:
    defs = " ".join(_constraint_defs(db, "alerts"))
    assert "approved_by IS NOT NULL" in defs
    assert "approved_at IS NOT NULL" in defs


def test_assessment_uniqueness_per_cycle(db: psycopg.Connection) -> None:
    defs = _constraint_defs(db, "assessments")
    assert any("UNIQUE" in d and "situation_id" in d and "cycle" in d for d in defs)


def test_delivery_unique_keys(db: psycopg.Connection) -> None:
    defs = " ".join(_constraint_defs(db, "deliveries"))
    assert "UNIQUE (idempotency_key)" in defs
    assert "UNIQUE (provider_message_id)" in defs


def test_dekad_check_exists(db: psycopg.Connection) -> None:
    defs = " ".join(_constraint_defs(db, "zone_climate_dekadal"))
    assert "1" in defs and "11" in defs and "21" in defs


def test_e164_check_on_recipients(db: psycopg.Connection) -> None:
    defs = " ".join(_constraint_defs(db, "recipients"))
    assert "~" in defs  # regex E.164 check


def test_partial_unique_open_situation(db: psycopg.Connection) -> None:
    with db.cursor() as cur:
        cur.execute(
            "SELECT indexdef FROM pg_indexes WHERE indexname = %s",
            ("uq_open_situation_per_zone_hazard",),
        )
        row = cur.fetchone()
    assert row is not None
    assert "open" in row["indexdef"] and "monitoring" in row["indexdef"]


def test_notify_triggers_exist(db: psycopg.Connection) -> None:
    with db.cursor() as cur:
        cur.execute("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")
        names = {r["tgname"] for r in cur.fetchall()}
    assert {"trg_notify_delivery", "trg_notify_alert", "trg_notify_assessment"} <= names


def test_required_extensions(db: psycopg.Connection) -> None:
    with db.cursor() as cur:
        cur.execute("SELECT extname FROM pg_extension")
        names = {r["extname"] for r in cur.fetchall()}
    assert {"postgis", "vector", "pgcrypto"} <= names


def test_map_view_exists(db: psycopg.Connection) -> None:
    with db.cursor() as cur:
        cur.execute("SELECT to_regclass('public.v_map_situations') AS v")
        assert db and cur.fetchone()["v"] is not None
