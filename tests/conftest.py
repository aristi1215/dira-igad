from __future__ import annotations

import os
import subprocess
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

import psycopg
import pytest
from dira_core.alerts import derive_idempotency_key
from psycopg.rows import dict_row

INTEGRATION_CLIMATE_START = date(2030, 1, 1)
INITIAL_DATABASE_URL = os.environ.get("DATABASE_URL")


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or INITIAL_DATABASE_URL
    if not url:
        pytest.skip("DATABASE_URL is required for integration tests")
    try:
        with psycopg.connect(url) as conn:
            _require_schema(conn)
            _ensure_seeded(url, conn)
    except psycopg.OperationalError as exc:
        pytest.skip(f"Postgres is unreachable: {exc}")
    return url


@pytest.fixture()
def db_conn(database_url: str) -> Any:
    conn = psycopg.connect(database_url, row_factory=dict_row)
    _cleanup(conn)
    try:
        yield conn
    finally:
        _cleanup(conn)
        conn.close()


@pytest.fixture()
def zone_ids(db_conn: Any) -> list[str]:
    with db_conn.cursor() as cur:
        cur.execute("SELECT id FROM zones ORDER BY id")
        return [str(row["id"]) for row in cur.fetchall()]


@pytest.fixture()
def zone_with_recipients(db_conn: Any) -> str:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT z.id
            FROM zones z
            JOIN recipients r ON r.zone_id = z.id AND r.active = TRUE
            GROUP BY z.id
            HAVING count(*) >= 2
            ORDER BY z.id
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if row is None:
        pytest.skip("Seed data needs a zone with at least two active recipients")
    return str(row["id"])


@pytest.fixture()
def first_zone_id(zone_ids: list[str]) -> str:
    if not zone_ids:
        pytest.skip("Seed data needs at least one zone")
    return zone_ids[0]


@pytest.fixture()
def make_situation(db_conn: Any) -> Callable[[str | None], UUID]:
    def _make(zone_id: str | None = None) -> UUID:
        if zone_id is None:
            with db_conn.cursor() as cur:
                cur.execute("SELECT id FROM zones ORDER BY id LIMIT 1")
                zone_id = str(cur.fetchone()["id"])
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO situations (zone_id, hazard, status, opened_cycle)
                VALUES (%s, 'conflict_pressure', 'open', DATE '2026-03-21')
                RETURNING id
                """,
                (zone_id,),
            )
            situation_id = cur.fetchone()["id"]
        db_conn.commit()
        return situation_id

    return _make


@pytest.fixture()
def make_alert(db_conn: Any, make_situation: Callable[[str | None], UUID]) -> Callable[..., UUID]:
    def _make(
        *,
        zone_id: str | None = None,
        status: str = "pending_approval",
        body_text: str = "Tahadhari ya hali.",
    ) -> UUID:
        situation_id = make_situation(zone_id)
        approved_by = "tester" if status in {"approved", "dispatching", "dispatched"} else None
        approved_at = datetime.now(UTC) if approved_by else None
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO alerts (
                  situation_id, status, body_text, created_by, approved_by, approved_at
                )
                VALUES (%s, %s, %s, 'integration', %s, %s)
                RETURNING id
                """,
                (situation_id, status, body_text, approved_by, approved_at),
            )
            alert_id = cur.fetchone()["id"]
        db_conn.commit()
        return alert_id

    return _make


@pytest.fixture()
def make_delivery(db_conn: Any, make_alert: Callable[..., UUID]) -> Callable[..., UUID]:
    def _make(
        *,
        zone_id: str | None = None,
        status: str = "queued",
        provider_message_id: str | None = None,
        attempt_count: int = 0,
    ) -> UUID:
        alert_id = make_alert(zone_id=zone_id, status="approved")
        with db_conn.cursor() as cur:
            if zone_id is None:
                cur.execute(
                    """
                    SELECT id, channel
                    FROM recipients
                    WHERE active = TRUE
                    ORDER BY id
                    LIMIT 1
                    """
                )
            else:
                cur.execute(
                    """
                    SELECT id, channel
                    FROM recipients
                    WHERE active = TRUE AND zone_id = %s
                    ORDER BY id
                    LIMIT 1
                    """,
                    (zone_id,),
                )
            recipient = cur.fetchone()
            if recipient is None:
                pytest.skip("Seed data needs an active recipient")
            idem = derive_idempotency_key(str(alert_id), str(recipient["id"]), recipient["channel"])
            cur.execute(
                """
                INSERT INTO deliveries (
                  alert_id, recipient_id, channel, idempotency_key, status,
                  provider_message_id, attempt_count
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    alert_id,
                    recipient["id"],
                    recipient["channel"],
                    idem,
                    status,
                    provider_message_id,
                    attempt_count,
                ),
            )
            delivery_id = cur.fetchone()["id"]
        db_conn.commit()
        return delivery_id

    return _make


def _require_schema(conn: Any) -> None:
    required = [
        "zones",
        "zone_climate_dekadal",
        "situations",
        "assessments",
        "alerts",
        "deliveries",
    ]
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", ("public.zones",))
        if cur.fetchone()[0] is None:
            pytest.skip("Dira schema is not applied to the integration database")
        for table in required:
            cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
            if cur.fetchone()[0] is None:
                pytest.skip(f"Dira schema table {table!r} is missing")


def _ensure_seeded(url: str, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM zones")
        zone_count = int(cur.fetchone()[0])
    if zone_count > 0:
        return
    env = {**os.environ, "DATABASE_URL": url}
    result = subprocess.run(
        ["uv", "run", "python", "scripts/bootstrap.py"],
        cwd="/workspace",
        env=env,
        check=False,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        pytest.skip(f"Could not seed integration database: {result.stderr or result.stdout}")


def _cleanup(conn: Any) -> None:
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute(
            """
            TRUNCATE deliveries, alerts, assessments, situations, news_signals
            RESTART IDENTITY CASCADE
            """
        )
        cur.execute("DELETE FROM news_documents WHERE external_id LIKE 'integration-%'")
        cur.execute("DELETE FROM acled_events WHERE event_id LIKE 'integration-%'")
        cur.execute(
            "DELETE FROM zone_climate_dekadal WHERE dekad_start >= %s",
            (INTEGRATION_CLIMATE_START,),
        )
        cur.execute("DELETE FROM model_versions WHERE id LIKE 'integration-%'")
    conn.commit()
