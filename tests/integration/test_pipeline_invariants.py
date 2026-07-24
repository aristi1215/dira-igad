from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any

import pytest
from dira_core.ports import Assessment, FeatureRow
from dira_worker import pipeline
from dira_worker.settings import Settings as WorkerSettings
from psycopg import sql

pytestmark = pytest.mark.integration


def test_pipeline_rerun_is_idempotent(database_url, db_conn) -> None:
    settings = WorkerSettings(database_url=database_url, data_mode="seeded")
    cycle = date(2026, 3, 21)

    assert pipeline.run_pipeline(cycle, settings=settings) == 0
    first = _hash_tables(
        db_conn,
        ["zone_climate_dekadal", "acled_events", "news_signals", "situations", "assessments"],
    )

    assert pipeline.run_pipeline(cycle, settings=settings) == 0
    second = _hash_tables(
        db_conn,
        ["zone_climate_dekadal", "acled_events", "news_signals", "situations", "assessments"],
    )

    assert second == first


def test_llm_failure_degrades(database_url, db_conn) -> None:
    settings = WorkerSettings(database_url=database_url, data_mode="seeded")

    assert pipeline.run_pipeline(
        date(2026, 3, 21),
        settings=settings,
        force_llm_failure=True,
    ) == 0

    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT corroboration, explanation, combination_rule
            FROM assessments
            ORDER BY zone_id
            """
        )
        rows = cur.fetchall()

    assert rows
    # The news channel degrades to exactly 0 for every zone; verified field
    # reports are an independent channel and may still corroborate.
    assert all("news 0.00" in str(row["combination_rule"]) for row in rows)
    for row in rows:
        if float(row["corroboration"]) > 0:
            assert "verified_field_reports" in str(row["combination_rule"])
    assert all(str(row["explanation"]).startswith("Operational band ") for row in rows)
    assert all(row["combination_rule"] for row in rows)


def test_showcase_never_partial(database_url, db_conn, make_situation) -> None:
    make_situation()
    before = _hash_tables(db_conn, ["situations", "assessments", "alerts", "deliveries"])
    settings = WorkerSettings(database_url=database_url, data_mode="seeded")

    with pytest.raises(RuntimeError, match="injected failure at E4"):
        pipeline.run_pipeline(
            date(2026, 3, 21),
            settings=settings,
            inject_fail_at="E4",
        )

    after = _hash_tables(db_conn, ["situations", "assessments", "alerts", "deliveries"])
    assert after == before


def test_situation_thread(db_conn, monkeypatch) -> None:
    monkeypatch.setattr(pipeline, "_active_model", lambda conn: (None, _HighRiskModel()))
    settings = WorkerSettings(database_url="postgresql://unused", data_mode="seeded")
    cycle_1 = date(2026, 3, 11)
    cycle_2 = date(2026, 3, 21)
    with db_conn.cursor() as cur:
        cur.execute("SELECT id FROM zones ORDER BY id")
        corroboration = {str(row["id"]): 1.0 for row in cur.fetchall()}

    pipeline.stage_e4_e7(db_conn, cycle_1, corroboration, settings)
    db_conn.commit()
    pipeline.stage_e4_e7(db_conn, cycle_2, corroboration, settings)
    db_conn.commit()

    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT zone_id, count(*) AS open_count
            FROM situations
            WHERE status = 'open'
            GROUP BY zone_id
            """
        )
        open_counts = {row["zone_id"]: int(row["open_count"]) for row in cur.fetchall()}
        cur.execute(
            """
            SELECT zone_id, count(DISTINCT situation_id) AS situation_threads
            FROM assessments
            GROUP BY zone_id
            """
        )
        assessment_threads = {
            row["zone_id"]: int(row["situation_threads"]) for row in cur.fetchall()
        }

    assert open_counts
    assert set(open_counts.values()) == {1}
    assert set(assessment_threads.values()) == {1}


def test_two_scores_independence(database_url, db_conn) -> None:
    settings = WorkerSettings(database_url=database_url, data_mode="seeded")
    cycle = date(2026, 3, 21)

    assert pipeline.run_pipeline(cycle, settings=settings, force_llm_failure=True) == 0
    no_news = _assessment_scores(db_conn)
    assert no_news

    assert pipeline.run_pipeline(cycle, settings=settings) == 0
    with_news = _assessment_scores(db_conn)

    # Model risk is pure: corroboration (news or field) never feeds back into it.
    assert {zid: score["model_risk"] for zid, score in with_news.items()} == {
        zid: score["model_risk"] for zid, score in no_news.items()
    }
    # News is one channel of corroboration: adding it can only raise the merged
    # score (max of channels), and must raise it somewhere.
    for zid, score in with_news.items():
        assert score["corroboration"] >= no_news[zid]["corroboration"]
    assert any(
        score["corroboration"] > no_news[zid]["corroboration"]
        for zid, score in with_news.items()
    )


class _HighRiskModel:
    def assess(self, features: FeatureRow) -> Assessment:
        return Assessment(
            prob_conflict=0.91,
            expected_incidents=3.0,
            model_risk=0.91,
            model_band="very_high",
            shap={"incident_count_dekad": 0.91},
        )


def _assessment_scores(db_conn: Any) -> dict[str, dict[str, float]]:
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT zone_id, model_risk, corroboration
            FROM assessments
            ORDER BY zone_id
            """
        )
        return {
            row["zone_id"]: {
                "model_risk": float(row["model_risk"]),
                "corroboration": float(row["corroboration"]),
            }
            for row in cur.fetchall()
        }


def _hash_tables(db_conn: Any, table_names: list[str]) -> str:
    payload = {table_name: _dump_table(db_conn, table_name) for table_name in table_names}
    encoded = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(encoded.encode()).hexdigest()


def _dump_table(db_conn: Any, table_name: str) -> list[dict[str, Any]]:
    allowed = {
        "acled_events",
        "alerts",
        "assessments",
        "deliveries",
        "news_signals",
        "situations",
        "zone_climate_dekadal",
    }
    assert table_name in allowed
    with db_conn.cursor() as cur:
        cur.execute(sql.SQL("SELECT * FROM {}").format(sql.Identifier(table_name)))
        rows = [dict(row) for row in cur.fetchall()]
    return sorted(rows, key=lambda row: json.dumps(row, sort_keys=True, default=str))
