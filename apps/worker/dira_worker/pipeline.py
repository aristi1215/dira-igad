"""Dekadal pipeline — stages E1–E7.

Usage:
  python -m dira_worker.pipeline --cycle 2026-03-11
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from dira_core.ports import Assessment, FeatureRow, LanguageModel
from dira_core.risk import (
    OPEN_BANDS,
    RESOLVE_BELOW_BANDS,
    RiskBand,
    combine_scores,
)
from dira_core.time import data_cutoff_for_cycle, validate_dekad_start
from dira_data.adapters import SeededRasterAdapter, get_conflict_source, get_hazard_source
from dira_data.climate import upsert_climate_first_write_wins
from dira_data.db import (
    connect,
    load_acled_events,
    load_adjacency_by_zone,
    load_climate_rows,
    load_exposure,
    load_zones,
)
from dira_data.tiles import render_placeholder_tile
from dira_features import build_feature_row
from dira_llm import CannedResponseAdapter, extract_signals, get_language_model
from dira_ml import LightGBMAdapter, TransparentIndexAdapter

from dira_worker.settings import Settings, get_settings

logger = logging.getLogger("dira.pipeline")

HAZARD = "conflict_pressure"
ROOT = Path(__file__).resolve().parents[3]
TILE_DIR = ROOT / "artifacts" / "tiles"
SEEDED_DIR = ROOT / "data" / "seeded"


def _parse_cycle(raw: str) -> date:
    return validate_dekad_start(date.fromisoformat(raw))


def _active_model(conn: Any) -> tuple[str | None, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, kind, artifact_path, feature_list
            FROM model_versions
            WHERE is_active = TRUE
            ORDER BY trained_at DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if row is None:
        return None, TransparentIndexAdapter()
    model_id = str(row["id"])
    kind = str(row["kind"])
    artifact_path = row["artifact_path"]
    if kind == "lightgbm" and artifact_path:
        try:
            return model_id, LightGBMAdapter(str(artifact_path))
        except Exception as exc:  # noqa: BLE001
            logger.warning("LightGBM load failed (%s); using TransparentIndex", exc)
    return model_id, TransparentIndexAdapter()


def _template_explanation(shap: dict[str, float], band: RiskBand) -> str:
    top = sorted(shap.items(), key=lambda kv: abs(kv[1]), reverse=True)[:3]
    parts = [f"{name} ({val:+.3f})" for name, val in top] or ["limited recent indicators"]
    return (
        f"Operational band {band.value} driven by top factors: "
        + ", ".join(parts)
        + ". Conditions and preparedness actions only — no named actors."
    )


def _signal_id(sig: dict[str, Any], cycle: date) -> uuid.UUID:
    material = json.dumps(
        {
            "document_id": str(sig.get("document_id") or ""),
            "zone_id": str(sig.get("zone_id") or ""),
            "signal_type": str(sig.get("signal_type") or ""),
            "excerpt": str(sig.get("excerpt") or ""),
            "cycle": cycle.isoformat(),
        },
        sort_keys=True,
    )
    return uuid.uuid5(uuid.NAMESPACE_URL, f"dira:news_signal:{material}")


def stage_e1_e2(conn: Any, cycle: date, settings: Settings) -> None:
    """Ingest conflict/hazard observations + first-write-wins climate + tiles."""
    zones = load_zones(conn)
    zone_ids = [str(z["id"]) for z in zones]
    conflict = get_conflict_source(settings.data_mode)
    hazard = get_hazard_source(settings.data_mode)

    events = conflict.events(zone_ids, since=date(2012, 1, 1))
    with conn.cursor() as cur:
        for ev in events:
            cur.execute(
                """
                INSERT INTO acled_events (
                  event_id, event_date, zone_id, event_type, fatalities,
                  actor1, actor2, notes, available_at, source
                ) VALUES (
                  %(event_id)s, %(event_date)s, %(zone_id)s, %(event_type)s,
                  %(fatalities)s, %(actor1)s, %(actor2)s, %(notes)s,
                  %(available_at)s, 'acled'
                )
                ON CONFLICT (event_id) DO NOTHING
                """,
                {
                    "event_id": ev.event_id,
                    "event_date": ev.event_date,
                    "zone_id": ev.zone_id,
                    "event_type": ev.event_type,
                    "fatalities": ev.fatalities,
                    "actor1": ev.actor1,
                    "actor2": ev.actor2,
                    "notes": ev.notes,
                    "available_at": ev.available_at
                    or datetime.combine(ev.event_date, datetime.min.time(), tzinfo=UTC),
                },
            )

    fetched = hazard.fetch_dekadal(zone_ids, cycle)
    climate_rows: list[dict[str, Any]] = []
    for zid, vals in fetched.items():
        climate_rows.append(
            {
                "zone_id": zid,
                "dekad_start": cycle,
                "rain_mm": vals.get("rain_mm"),
                "rain_available_at": vals.get("rain_available_at"),
                "ndvi_mean": vals.get("ndvi_mean"),
                "ndvi_available_at": vals.get("ndvi_available_at"),
            }
        )

    # Seeded: also allow backfill of prior dekads from fixtures (idempotent FWW).
    if settings.data_mode == "seeded":
        adapter = SeededRasterAdapter(SEEDED_DIR)
        all_rows = json.loads((SEEDED_DIR / "mandera/climate/climate.json").read_text())
        for row in all_rows:
            if row["zone_id"] in zone_ids:
                climate_rows.append(
                    {
                        "zone_id": row["zone_id"],
                        "dekad_start": date.fromisoformat(row["dekad_start"]),
                        "rain_mm": row.get("rain_mm"),
                        "rain_available_at": row.get("rain_available_at"),
                        "ndvi_mean": row.get("ndvi_mean"),
                        "ndvi_available_at": row.get("ndvi_available_at"),
                    }
                )
        _ = adapter  # silence unused if path always taken

    upsert_climate_first_write_wins(conn, climate_rows)
    TILE_DIR.mkdir(parents=True, exist_ok=True)
    render_placeholder_tile("rain", cycle, TILE_DIR)
    render_placeholder_tile("ndvi", cycle, TILE_DIR)
    conn.commit()


def stage_e3(
    conn: Any, cycle: date, llm: LanguageModel, *, fail_llm: bool = False
) -> dict[str, float]:
    """News → signals. Returns zone_id → corroboration. Degrades on LLM failure."""
    if fail_llm:
        raise RuntimeError("injected LLM failure")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, body, source, published_at, available_at
            FROM news_documents
            WHERE available_at <= %s
            """,
            (datetime.combine(data_cutoff_for_cycle(cycle), datetime.max.time(), tzinfo=UTC),),
        )
        docs = [dict(r) for r in cur.fetchall()]
        for d in docs:
            d["id"] = str(d["id"])
        cur.execute("SELECT id FROM zones")
        zone_ids = [str(r["id"]) for r in cur.fetchall()]

    try:
        signals = extract_signals(docs, llm, zone_ids, cycle)
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM signal extraction failed — degrading: %s", exc)
        return {zid: 0.0 for zid in zone_ids}

    corroboration: dict[str, float] = {zid: 0.0 for zid in zone_ids}
    with conn.cursor() as cur:
        # Idempotent rerun: this cycle's signals are fully re-derived each run.
        cur.execute("DELETE FROM news_signals WHERE cycle = %s", (cycle,))
        for sig in signals:
            doc_id = sig.get("document_id")
            zid = sig.get("zone_id")
            cur.execute(
                """
                INSERT INTO news_signals (
                  id, document_id, zone_id, signal_type, confidence, status, excerpt, cycle
                ) VALUES (%s, %s, %s, %s, %s, 'unconfirmed', %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                  document_id = EXCLUDED.document_id,
                  zone_id = EXCLUDED.zone_id,
                  signal_type = EXCLUDED.signal_type,
                  confidence = EXCLUDED.confidence,
                  status = EXCLUDED.status,
                  excerpt = EXCLUDED.excerpt,
                  cycle = EXCLUDED.cycle
                """,
                (
                    _signal_id(sig, cycle),
                    uuid.UUID(str(doc_id)) if doc_id else None,
                    zid,
                    sig["signal_type"],
                    float(sig["confidence"]),
                    sig.get("excerpt"),
                    cycle,
                ),
            )
            if zid:
                corroboration[str(zid)] = max(
                    corroboration.get(str(zid), 0.0), float(sig["confidence"])
                )
    conn.commit()
    return corroboration


def _ensure_situation(
    cur: Any,
    zone_id: str,
    cycle: date,
    operational_band: RiskBand,
    resolve_after: int,
) -> uuid.UUID | None:
    cur.execute(
        """
        SELECT id, status, cycles_below_threshold
        FROM situations
        WHERE zone_id = %s AND hazard = %s AND status = 'open'
        FOR UPDATE
        """,
        (zone_id, HAZARD),
    )
    row = cur.fetchone()

    if operational_band in OPEN_BANDS:
        if row is None:
            sid = uuid.uuid4()
            cur.execute(
                """
                INSERT INTO situations (id, zone_id, hazard, status, opened_cycle)
                VALUES (%s, %s, %s, 'open', %s)
                """,
                (sid, zone_id, HAZARD, cycle),
            )
            return sid
        cur.execute(
            """
            UPDATE situations
            SET cycles_below_threshold = 0, updated_at = now()
            WHERE id = %s AND cycles_below_threshold <> 0
            """,
            (row["id"],),
        )
        return uuid.UUID(str(row["id"]))

    if row is None:
        return None

    sid = uuid.UUID(str(row["id"]))
    below = int(row["cycles_below_threshold"])
    if operational_band in RESOLVE_BELOW_BANDS:
        below += 1
        if below >= resolve_after:
            cur.execute(
                """
                UPDATE situations
                SET status = 'resolved', resolved_cycle = %s,
                    cycles_below_threshold = %s, updated_at = now()
                WHERE id = %s
                """,
                (cycle, below, sid),
            )
            return None
        cur.execute(
            """
            UPDATE situations
            SET cycles_below_threshold = %s, updated_at = now()
            WHERE id = %s
            """,
            (below, sid),
        )
        return sid

    cur.execute(
        "UPDATE situations SET cycles_below_threshold = 0, updated_at = now() WHERE id = %s",
        (sid,),
    )
    return sid


def stage_e4_e7(
    conn: Any,
    cycle: date,
    corroboration: dict[str, float],
    settings: Settings,
    *,
    inject_fail_at: str | None = None,
) -> None:
    """Features → predict → combine → storefront (one Tx per zone)."""
    if inject_fail_at == "E4":
        raise RuntimeError("injected failure at E4")

    cutoff = datetime.combine(data_cutoff_for_cycle(cycle), datetime.max.time(), tzinfo=UTC)
    zones = load_zones(conn)
    climate_rows = load_climate_rows(conn)
    acled = load_acled_events(conn)
    adjacency = load_adjacency_by_zone(conn)
    exposure = load_exposure(conn)
    model_id, model = _active_model(conn)

    prepared: list[dict[str, Any]] = []
    for z in zones:
        zid = str(z["id"])
        features: FeatureRow = build_feature_row(
            zid,
            cycle,
            climate_rows=climate_rows,
            acled_events=acled,
            adjacency_neighbor_ids=adjacency.get(zid, []),
            data_cutoff=cutoff,
        )
        assessment: Assessment = model.assess(features)
        model_band = RiskBand(assessment.model_band)
        corr = float(corroboration.get(zid, 0.0))
        op_band, rule = combine_scores(assessment.model_risk, corr, model_band=model_band)
        explanation = _template_explanation(assessment.shap, op_band)
        prepared.append(
            {
                "zone_id": zid,
                "assessment": assessment,
                "corroboration": corr,
                "operational_band": op_band,
                "combination_rule": rule,
                "explanation": explanation,
                "exposure": exposure.get(zid, {}),
            }
        )

    for item in prepared:
        if inject_fail_at == "E7_mid" and item["zone_id"] == "mandera_ke_north":
            raise RuntimeError("injected failure mid E7")

        with conn.transaction():
            with conn.cursor() as cur:
                sid = _ensure_situation(
                    cur,
                    item["zone_id"],
                    cycle,
                    item["operational_band"],
                    settings.resolve_after_cycles_below_threshold,
                )
                a = item["assessment"]
                cur.execute(
                    """
                    INSERT INTO assessments (
                      id, situation_id, zone_id, cycle, model_version_id,
                      prob_conflict, expected_incidents, model_risk, model_band,
                      corroboration, operational_band, combination_rule, explanation,
                      shap, exposure_snapshot
                    ) VALUES (
                      %s, %s, %s, %s, %s,
                      %s, %s, %s, %s,
                      %s, %s, %s, %s,
                      %s::jsonb, %s::jsonb
                    )
                    ON CONFLICT (zone_id, cycle) DO UPDATE SET
                      situation_id = COALESCE(EXCLUDED.situation_id, assessments.situation_id),
                      model_version_id = EXCLUDED.model_version_id,
                      prob_conflict = EXCLUDED.prob_conflict,
                      expected_incidents = EXCLUDED.expected_incidents,
                      model_risk = EXCLUDED.model_risk,
                      model_band = EXCLUDED.model_band,
                      corroboration = EXCLUDED.corroboration,
                      operational_band = EXCLUDED.operational_band,
                      combination_rule = EXCLUDED.combination_rule,
                      explanation = EXCLUDED.explanation,
                      shap = EXCLUDED.shap,
                      exposure_snapshot = EXCLUDED.exposure_snapshot
                    """,
                    (
                        uuid.uuid4(),
                        sid,
                        item["zone_id"],
                        cycle,
                        model_id,
                        a.prob_conflict,
                        a.expected_incidents,
                        a.model_risk,
                        a.model_band,
                        item["corroboration"],
                        item["operational_band"].value,
                        item["combination_rule"],
                        item["explanation"],
                        json.dumps(a.shap),
                        json.dumps(item["exposure"], default=str),
                    ),
                )


def run_pipeline(
    cycle: date,
    *,
    settings: Settings | None = None,
    llm: LanguageModel | None = None,
    inject_fail_at: str | None = None,
    force_llm_failure: bool = False,
) -> int:
    """Run E1–E7. Exit 0 on success or degradable failure; raise/return 1 on hard failure."""
    settings = settings or get_settings()
    if llm is None:
        # Seeded mode stays deterministic; live mode uses OpenAI/Anthropic when keyed.
        llm = (
            get_language_model(
                openai_api_key=settings.openai_api_key,
                anthropic_api_key=settings.anthropic_api_key,
            )
            if settings.data_mode == "live"
            else CannedResponseAdapter()
        )

    with connect(settings.database_url) as conn:
        stage_e1_e2(conn, cycle, settings)

        try:
            corroboration = stage_e3(conn, cycle, llm, fail_llm=force_llm_failure)
        except Exception as exc:  # noqa: BLE001
            logger.warning("E3 degraded: %s", exc)
            zones = load_zones(conn)
            corroboration = {str(z["id"]): 0.0 for z in zones}

        try:
            stage_e4_e7(
                conn, cycle, corroboration, settings, inject_fail_at=inject_fail_at
            )
        except Exception:
            conn.rollback()
            raise

    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Dira dekadal pipeline worker")
    parser.add_argument(
        "--cycle",
        required=True,
        help="Dekada start date (YYYY-MM-DD); day must be 1, 11, or 21",
    )
    args = parser.parse_args(argv)
    try:
        cycle = _parse_cycle(args.cycle)
    except Exception as exc:
        print(f"Invalid cycle: {exc}", file=sys.stderr)
        return 2
    try:
        code = run_pipeline(cycle)
        print(f"[dira-pipeline] completed cycle={cycle.isoformat()} exit={code}")
        return code
    except Exception as exc:
        logger.exception("Pipeline hard failure: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
