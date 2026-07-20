"""M5 acceptance (named invariant tests). Full pipeline against a real Postgres."""

from __future__ import annotations

from datetime import date

import psycopg
import pytest
from dira_core.ports import Assessment, FeatureRow
from dira_data import fixtures
from dira_data.repositories import geo
from dira_data.repositories import news as news_repo
from dira_worker import pipeline, stages_late

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _tiles(tmp_path, monkeypatch):
    monkeypatch.setenv("DIRA_TILES_DIR", str(tmp_path))


def _bootstrap(conn: psycopg.Connection) -> None:
    geo.load_zones_geojson(conn, fixtures.seeded_dir() / "zones.geojson")
    geo.compute_adjacency(conn)
    geo.upsert_exposure(conn, fixtures.load_json("exposure.json"))
    geo.upsert_recipients(conn, fixtures.load_json("recipients.json"))


class FakeRiskModel:
    """Deterministic RiskModel returning a fixed risk (to drive hysteresis in tests)."""

    kind = "transparent_index"

    def __init__(self, risk: float) -> None:
        self.risk = risk

    def assess(self, features: FeatureRow) -> Assessment:
        band = "red" if self.risk >= 0.75 else "green"
        return Assessment(self.risk, self.risk * 5, self.risk, band, {"incidents_sum3": self.risk})


class BoomLM:
    """LanguageModel that always fails (for the degradation test)."""

    def complete(self, prompt, *, system=None):
        raise RuntimeError("LLM down")

    def complete_json(self, prompt, *, system=None):
        raise RuntimeError("LLM down")


def _showcase_dump(conn: psycopg.Connection) -> dict:
    out = {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT situation_id, cycle, model_risk, operational_band, corroboration, "
            "combination_rule FROM assessments ORDER BY situation_id, cycle"
        )
        out["assessments"] = [tuple(r.values()) for r in cur.fetchall()]
        cur.execute("SELECT zone_id, status FROM situations ORDER BY zone_id, opened_at")
        out["situations"] = [tuple(r.values()) for r in cur.fetchall()]
        cur.execute(
            "SELECT assessment_id, population FROM exposure_snapshots ORDER BY assessment_id"
        )
        out["exposure"] = [tuple(r.values()) for r in cur.fetchall()]
    return out


def test_pipeline_rerun_is_idempotent(db: psycopg.Connection) -> None:
    _bootstrap(db)
    pipeline.run_pipeline(date(2026, 1, 1), db)
    first = _showcase_dump(db)
    pipeline.run_pipeline(date(2026, 1, 1), db)  # same cycle again
    second = _showcase_dump(db)
    assert first == second
    # No duplicate assessment for any (situation, cycle).
    with db.cursor() as cur:
        cur.execute(
            "SELECT situation_id, cycle, count(*) c FROM assessments "
            "GROUP BY 1,2 HAVING count(*) > 1"
        )
        assert cur.fetchall() == []


def test_llm_failure_degrades(db: psycopg.Connection) -> None:
    _bootstrap(db)
    result = pipeline.run_pipeline(date(2026, 1, 1), db, lm=BoomLM())
    assert result.degraded is True
    with db.cursor() as cur:
        cur.execute("SELECT corroboration, explanation, combination_rule FROM assessments")
        rows = cur.fetchall()
    assert rows, "assessments should still be written"
    for r in rows:
        assert r["corroboration"] == 0.0
        assert r["combination_rule"]  # rule recorded
        assert r["explanation"]  # template explanation present


def test_showcase_never_partial_crash_before_e7(db: psycopg.Connection, monkeypatch) -> None:
    _bootstrap(db)
    pipeline.run_pipeline(date(2026, 1, 1), db)  # cycle 1 succeeds
    before = _showcase_dump(db)

    # Inject a crash during E4 of cycle 2 (before any storefront write).
    def boom(*a, **k):
        raise RuntimeError("injected E4 crash")

    monkeypatch.setattr(stages_late.features_io, "build_feature_builder", boom)
    with pytest.raises(RuntimeError):
        pipeline.run_pipeline(date(2026, 1, 11), db)
    after = _showcase_dump(db)
    assert after == before  # storefront exactly as the previous cycle


def test_showcase_atomic_per_zone_crash_mid_e7(db: psycopg.Connection, monkeypatch) -> None:
    _bootstrap(db)
    real = stages_late.sit_repo.upsert_exposure_snapshot
    calls = {"n": 0}

    def flaky(conn, assessment_id, zone_id):
        calls["n"] += 1
        if calls["n"] == 3:  # fail on the 3rd zone, mid-transaction
            raise RuntimeError("injected E7 crash")
        return real(conn, assessment_id, zone_id)

    monkeypatch.setattr(stages_late.sit_repo, "upsert_exposure_snapshot", flaky)
    with pytest.raises(RuntimeError):
        pipeline.run_pipeline(date(2026, 1, 1), db)
    # Every zone that has an assessment must also have an exposure snapshot (atomic per zone).
    with db.cursor() as cur:
        cur.execute(
            "SELECT count(*) c FROM assessments a "
            "LEFT JOIN exposure_snapshots e ON e.assessment_id = a.id WHERE e.assessment_id IS NULL"
        )
        assert cur.fetchone()["c"] == 0


def test_situation_thread(db: psycopg.Connection) -> None:
    _bootstrap(db)
    zone = "z_ke_mandera_town"
    # Two cycles over threshold -> one situation, two assessments.
    pipeline.run_pipeline(date(2026, 1, 1), db, risk_model=FakeRiskModel(0.95))
    pipeline.run_pipeline(date(2026, 1, 11), db, risk_model=FakeRiskModel(0.95))
    with db.cursor() as cur:
        cur.execute("SELECT id FROM situations WHERE zone_id=%s AND status='open'", (zone,))
        sit = cur.fetchall()
        assert len(sit) == 1
        cur.execute("SELECT count(*) c FROM assessments WHERE situation_id=%s", (sit[0]["id"],))
        assert cur.fetchone()["c"] == 2

    # Partial unique index forbids a second open situation for the same (zone, hazard).
    with pytest.raises(psycopg.errors.UniqueViolation):
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO situations (zone_id, hazard_type, status) "
                "VALUES (%s,'conflict','open')",
                (zone,),
            )

    # N cycles below the low threshold -> resolved.
    for c in (date(2026, 1, 21), date(2026, 2, 1), date(2026, 2, 11)):
        pipeline.run_pipeline(c, db, risk_model=FakeRiskModel(0.05))
    with db.cursor() as cur:
        cur.execute("SELECT status FROM situations WHERE zone_id=%s ORDER BY opened_at", (zone,))
        assert cur.fetchone()["status"] == "resolved"


def test_two_scores_independence(db: psycopg.Connection) -> None:
    _bootstrap(db)
    pipeline.run_pipeline(date(2026, 1, 1), db)
    with db.cursor() as cur:
        cur.execute(
            "SELECT situation_id, model_risk, prob_conflict, corroboration, operational_band "
            "FROM assessments"
        )
        before = {r["situation_id"]: dict(r) for r in cur.fetchall()}

    # Change the news picture: confirm all signals (news now corroborates).
    with db.cursor() as cur:
        cur.execute("SELECT id FROM news_signals")
        for r in cur.fetchall():
            news_repo.confirm_signal(db, r["id"])

    pipeline.run_pipeline(date(2026, 1, 1), db)  # same cycle, changed news
    with db.cursor() as cur:
        cur.execute(
            "SELECT situation_id, model_risk, prob_conflict, corroboration, operational_band "
            "FROM assessments"
        )
        after = {r["situation_id"]: dict(r) for r in cur.fetchall()}

    for sid, b in before.items():
        a = after[sid]
        # Climate/history scores must be untouched by news.
        assert a["model_risk"] == b["model_risk"]
        assert a["prob_conflict"] == b["prob_conflict"]
