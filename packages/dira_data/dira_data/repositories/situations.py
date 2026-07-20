"""Storefront writes for E7. Callers wrap each ZONE in its own transaction (atomic per zone).

Idempotency (invariant 3): assessments upsert on (situation_id, cycle); created_at/opened_at
are written once and never rewritten, so re-running a cycle yields identical rows.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import psycopg


def get_open_situation(
    conn: psycopg.Connection, zone_id: str, hazard: str
) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, status, opened_at, cycles_below_threshold FROM situations "
            "WHERE zone_id=%s AND hazard_type=%s AND status IN ('open','monitoring')",
            (zone_id, hazard),
        )
        return cur.fetchone()


def prior_bands(conn: psycopg.Connection, situation_id: str, cycle: Any) -> list[str]:
    """Operational bands of this situation's earlier cycles, newest first (for hysteresis)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT operational_band FROM assessments WHERE situation_id=%s AND cycle < %s "
            "ORDER BY cycle DESC",
            (situation_id, cycle),
        )
        return [r["operational_band"] for r in cur.fetchall()]


def open_situation(
    conn: psycopg.Connection, zone_id: str, hazard: str, opened_at: datetime, status: str = "open"
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO situations (zone_id, hazard_type, status, opened_at) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (zone_id, hazard, status, opened_at),
        )
        return str(cur.fetchone()["id"])


def set_status(
    conn: psycopg.Connection,
    situation_id: str,
    status: str,
    *,
    cycles_below: int | None = None,
    resolved_at: datetime | None = None,
    dismissed_at: datetime | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE situations SET status=%s, "
            "cycles_below_threshold=COALESCE(%s, cycles_below_threshold), "
            "resolved_at=COALESCE(%s, resolved_at), dismissed_at=COALESCE(%s, dismissed_at) "
            "WHERE id=%s",
            (status, cycles_below, resolved_at, dismissed_at, situation_id),
        )


def upsert_assessment(conn: psycopg.Connection, row: dict[str, Any]) -> str:
    """Insert/replace the assessment for (situation_id, cycle). created_at kept on conflict."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO assessments
                (situation_id, cycle, data_cutoff, prob_conflict, expected_incidents,
                 model_risk, model_band, corroboration, operational_band, combination_rule,
                 explanation, shap, model_version_id)
            VALUES (%(situation_id)s, %(cycle)s, %(data_cutoff)s, %(prob_conflict)s,
                    %(expected_incidents)s, %(model_risk)s, %(model_band)s, %(corroboration)s,
                    %(operational_band)s, %(combination_rule)s, %(explanation)s, %(shap)s,
                    %(model_version_id)s)
            ON CONFLICT (situation_id, cycle) DO UPDATE SET
                data_cutoff=EXCLUDED.data_cutoff, prob_conflict=EXCLUDED.prob_conflict,
                expected_incidents=EXCLUDED.expected_incidents, model_risk=EXCLUDED.model_risk,
                model_band=EXCLUDED.model_band, corroboration=EXCLUDED.corroboration,
                operational_band=EXCLUDED.operational_band,
                combination_rule=EXCLUDED.combination_rule, explanation=EXCLUDED.explanation,
                shap=EXCLUDED.shap, model_version_id=EXCLUDED.model_version_id
            RETURNING id
            """,
            {**row, "shap": json.dumps(row["shap"])},
        )
        return str(cur.fetchone()["id"])


def upsert_exposure_snapshot(conn: psycopg.Connection, assessment_id: str, zone_id: str) -> None:
    """Freeze the zone's current exposure onto the assessment (idempotent)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO exposure_snapshots (assessment_id, population, households)
            SELECT %s, population, households FROM zone_exposure WHERE zone_id=%s
            ON CONFLICT (assessment_id) DO UPDATE SET
                population=EXCLUDED.population, households=EXCLUDED.households
            """,
            (assessment_id, zone_id),
        )
