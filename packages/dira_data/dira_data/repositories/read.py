"""Read models for the API: map view, situation detail, delivery panel."""

from __future__ import annotations

from typing import Any

import psycopg


def map_situations(conn: psycopg.Connection) -> dict[str, Any]:
    """v_map_situations as a GeoJSON FeatureCollection."""
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM v_map_situations")
        rows = cur.fetchall()
    features = []
    for r in rows:
        geom = r.pop("geometry")
        features.append({"type": "Feature", "geometry": geom, "properties": dict(r)})
    return {"type": "FeatureCollection", "features": features}


def latest_assessment(conn: psycopg.Connection, situation_id: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.*, es.population AS exposed_population, es.households AS exposed_households "
            "FROM assessments a LEFT JOIN exposure_snapshots es ON es.assessment_id=a.id "
            "WHERE a.situation_id=%s ORDER BY a.cycle DESC LIMIT 1",
            (situation_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def situation_detail(conn: psycopg.Connection, situation_id: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT s.id, s.zone_id, z.name AS zone_name, z.country, s.hazard_type, s.status, "
            "s.opened_at, s.resolved_at FROM situations s JOIN zones z ON z.id=s.zone_id "
            "WHERE s.id=%s",
            (situation_id,),
        )
        sit = cur.fetchone()
        if sit is None:
            return None
        cur.execute(
            "SELECT id, cycle, model_risk, model_band, prob_conflict, expected_incidents, "
            "corroboration, operational_band, combination_rule, explanation, shap "
            "FROM assessments WHERE situation_id=%s ORDER BY cycle",
            (situation_id,),
        )
        assessments = [dict(r) for r in cur.fetchall()]
    detail = dict(sit)
    detail["assessments"] = assessments
    return detail


def zone_name(conn: psycopg.Connection, zone_id: str) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM zones WHERE id=%s", (zone_id,))
        row = cur.fetchone()
    return row["name"] if row else zone_id


def deliveries_for_alert(conn: psycopg.Connection, alert_id: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT d.id, d.status, d.ack_status, d.ack_method, d.attempts, d.provider_message_id, "
            "r.name AS recipient_name, r.phone FROM deliveries d "
            "JOIN recipients r ON r.id=d.recipient_id WHERE d.alert_id=%s ORDER BY d.created_at",
            (alert_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def needs_review(conn: psycopg.Connection) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, alert_id, status, attempts, last_error FROM deliveries "
            "WHERE status='needs_review' ORDER BY updated_at"
        )
        return [dict(r) for r in cur.fetchall()]
