"""Information-layer persistence: IPC, displacement, prices, health, hazards, field reports.

Shared by scripts/bootstrap.py (seeded fixtures), the pipeline's E1 refresh and
the live adapters. All upserts are idempotent; deterministic UUIDs derive from
the fixture ids so re-running bootstrap never duplicates rows.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

FIXTURE_NAMESPACE = uuid.UUID("9a1f4a48-1f3f-4c8e-9a8f-1f0e5b6d7c21")

INFORMATION_FIXTURES = {
    "food_security": "igad/food_security.json",
    "displacement": "igad/displacement.json",
    "market_prices": "igad/market_prices.json",
    "health": "igad/health.json",
    "hazard_bulletins": "igad/hazard_bulletins.json",
    "field_reports": "igad/field_reports.json",
}


def load_information_fixtures(seeded_dir: Path) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for kind, rel in INFORMATION_FIXTURES.items():
        path = seeded_dir / rel
        out[kind] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    return out


def deterministic_id(kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(FIXTURE_NAMESPACE, f"dira:{kind}:{key}")


def upsert_food_security(cur: Any, rows: list[dict[str, Any]]) -> None:
    for r in rows:
        cur.execute(
            """
            INSERT INTO food_security (
              zone_id, period_start, period_end, ipc_phase, pop_phase3_plus,
              source, available_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (zone_id, period_start) DO UPDATE
            SET period_end = EXCLUDED.period_end,
                ipc_phase = EXCLUDED.ipc_phase,
                pop_phase3_plus = EXCLUDED.pop_phase3_plus,
                source = EXCLUDED.source,
                available_at = EXCLUDED.available_at
            """,
            (
                r["zone_id"], r["period_start"], r["period_end"], r["ipc_phase"],
                r.get("pop_phase3_plus"), r.get("source", "seeded_ipc"), r["available_at"],
            ),
        )


def upsert_displacement(cur: Any, rows: list[dict[str, Any]]) -> None:
    for r in rows:
        cur.execute(
            """
            INSERT INTO displacement (
              zone_id, snapshot_date, idps, refugees, returnees, source, available_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (zone_id, snapshot_date) DO UPDATE
            SET idps = EXCLUDED.idps,
                refugees = EXCLUDED.refugees,
                returnees = EXCLUDED.returnees,
                source = EXCLUDED.source,
                available_at = EXCLUDED.available_at
            """,
            (
                r["zone_id"], r["snapshot_date"], r.get("idps", 0), r.get("refugees", 0),
                r.get("returnees", 0), r.get("source", "seeded_dtm"), r["available_at"],
            ),
        )


def upsert_market_prices(cur: Any, rows: list[dict[str, Any]]) -> None:
    for r in rows:
        cur.execute(
            """
            INSERT INTO market_prices (
              zone_id, market_name, month, commodity, unit, price, currency,
              pct_vs_3m_avg, source, available_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (zone_id, market_name, month, commodity) DO UPDATE
            SET unit = EXCLUDED.unit,
                price = EXCLUDED.price,
                currency = EXCLUDED.currency,
                pct_vs_3m_avg = EXCLUDED.pct_vs_3m_avg,
                source = EXCLUDED.source,
                available_at = EXCLUDED.available_at
            """,
            (
                r["zone_id"], r["market_name"], r["month"], r["commodity"], r["unit"],
                r["price"], r["currency"], r.get("pct_vs_3m_avg"),
                r.get("source", "seeded_wfp"), r["available_at"],
            ),
        )


def upsert_health(cur: Any, rows: list[dict[str, Any]]) -> None:
    for r in rows:
        cur.execute(
            """
            INSERT INTO health_surveillance (
              zone_id, week_start, disease, cases, deaths, status, source, available_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (zone_id, week_start, disease) DO UPDATE
            SET cases = EXCLUDED.cases,
                deaths = EXCLUDED.deaths,
                status = EXCLUDED.status,
                source = EXCLUDED.source,
                available_at = EXCLUDED.available_at
            """,
            (
                r["zone_id"], r["week_start"], r["disease"], r.get("cases", 0), r.get("deaths", 0),
                r.get("status", "monitoring"), r.get("source", "seeded_who"),
                r["available_at"],
            ),
        )


def upsert_hazard_bulletins(cur: Any, rows: list[dict[str, Any]]) -> None:
    for r in rows:
        bulletin_id = deterministic_id(
            "hazard_bulletin",
            f"{r['zone_id']}:{r['hazard_type']}:{r['valid_from']}:{r['headline']}",
        )
        cur.execute(
            """
            INSERT INTO hazard_bulletins (
              id, zone_id, hazard_type, severity, headline, detail,
              valid_from, valid_to, source, available_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET severity = EXCLUDED.severity,
                detail = EXCLUDED.detail,
                valid_to = EXCLUDED.valid_to,
                source = EXCLUDED.source,
                available_at = EXCLUDED.available_at
            """,
            (
                bulletin_id, r["zone_id"], r["hazard_type"], r["severity"], r["headline"],
                r.get("detail"), r["valid_from"], r.get("valid_to"),
                r.get("source", "seeded_bulletin"), r["available_at"],
            ),
        )


def upsert_field_reports(cur: Any, rows: list[dict[str, Any]]) -> None:
    """Seeded/live field reports. Verification state comes with the row; the
    schema CHECK still guarantees `verified` implies a named verifier."""
    for r in rows:
        report_id = deterministic_id("field_report", str(r["id"]))
        cur.execute(
            """
            INSERT INTO field_reports (
              id, zone_id, reporter_role, category, severity, narrative,
              reported_at, status, verified_by, verified_at, available_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET reporter_role = EXCLUDED.reporter_role,
                category = EXCLUDED.category,
                severity = EXCLUDED.severity,
                narrative = EXCLUDED.narrative,
                reported_at = EXCLUDED.reported_at,
                status = EXCLUDED.status,
                verified_by = EXCLUDED.verified_by,
                verified_at = EXCLUDED.verified_at,
                available_at = EXCLUDED.available_at
            """,
            (
                report_id, r["zone_id"], r["reporter_role"], r["category"], r["severity"],
                r["narrative"], r["reported_at"], r.get("status", "unverified"),
                r.get("verified_by"), r.get("verified_at"), r["available_at"],
            ),
        )


def refresh_information_layer(
    cur: Any, fixtures: dict[str, list[dict[str, Any]]]
) -> dict[str, int]:
    """Apply every information-layer dataset idempotently. Returns row counts."""
    upsert_food_security(cur, fixtures.get("food_security", []))
    upsert_displacement(cur, fixtures.get("displacement", []))
    upsert_market_prices(cur, fixtures.get("market_prices", []))
    upsert_health(cur, fixtures.get("health", []))
    upsert_hazard_bulletins(cur, fixtures.get("hazard_bulletins", []))
    upsert_field_reports(cur, fixtures.get("field_reports", []))
    return {kind: len(rows) for kind, rows in fixtures.items()}


# --------------------------------------------------------------------------
# Read side
# --------------------------------------------------------------------------

def load_zone_context(conn: Any) -> list[dict[str, Any]]:
    """Latest indicator values per zone (v_zone_context)."""
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM v_zone_context ORDER BY zone_id")
        return [dict(r) for r in cur.fetchall()]


def load_verified_field_severities(
    conn: Any, cutoff: datetime, window_days: int = 30
) -> dict[str, list[int]]:
    """Severities of VERIFIED field reports per zone inside the corroboration
    window, respecting the bitemporal cut. Unverified reports never appear here
    — that is the red line."""
    since = cutoff - timedelta(days=window_days)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT zone_id, severity
            FROM field_reports
            WHERE status = 'verified'
              AND reported_at >= %s
              AND reported_at <= %s
              AND available_at <= %s
            """,
            (since, cutoff, cutoff),
        )
        out: dict[str, list[int]] = {}
        for row in cur.fetchall():
            out.setdefault(str(row["zone_id"]), []).append(int(row["severity"]))
        return out


def load_context_snapshot(conn: Any, zone_id: str, cutoff: date | None = None) -> dict[str, Any]:
    """Latest IPC / displacement / staple-price anomaly for one zone, for the
    frozen exposure snapshot on assessments. Context only — never model input."""
    snapshot: dict[str, Any] = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ipc_phase, pop_phase3_plus FROM food_security
            WHERE zone_id = %s AND (%s::date IS NULL OR period_start <= %s)
            ORDER BY period_start DESC LIMIT 1
            """,
            (zone_id, cutoff, cutoff),
        )
        row = cur.fetchone()
        if row:
            snapshot["ipc_phase"] = row["ipc_phase"]
            snapshot["pop_phase3_plus"] = row["pop_phase3_plus"]
        cur.execute(
            """
            SELECT idps, refugees FROM displacement
            WHERE zone_id = %s AND (%s::date IS NULL OR snapshot_date <= %s)
            ORDER BY snapshot_date DESC LIMIT 1
            """,
            (zone_id, cutoff, cutoff),
        )
        row = cur.fetchone()
        if row:
            snapshot["idps"] = row["idps"]
            snapshot["refugees"] = row["refugees"]
        cur.execute(
            """
            SELECT commodity, pct_vs_3m_avg FROM market_prices
            WHERE zone_id = %s AND commodity IN ('maize', 'sorghum')
              AND (%s::date IS NULL OR month <= %s)
            ORDER BY month DESC, commodity LIMIT 1
            """,
            (zone_id, cutoff, cutoff),
        )
        row = cur.fetchone()
        if row:
            snapshot["staple_commodity"] = row["commodity"]
            snapshot["staple_pct_vs_3m_avg"] = (
                float(row["pct_vs_3m_avg"]) if row["pct_vs_3m_avg"] is not None else None
            )
    return snapshot
