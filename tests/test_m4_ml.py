"""M4 acceptance: train/serve skew, baselines in the model card, no actor-derived features."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import psycopg
import pytest
from dira_data import fixtures
from dira_data.repositories import geo
from dira_features import FEATURE_NAMES, FeatureBuilder, enumerate_dekads
from dira_ml.dataset import _cutoff
from dira_worker import features_io, pipeline
from dira_worker.cycle import data_cutoff

pytestmark = pytest.mark.integration

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"


def _bootstrap(conn: psycopg.Connection) -> None:
    geo.load_zones_geojson(conn, fixtures.seeded_dir() / "zones.geojson")
    geo.compute_adjacency(conn)
    geo.upsert_exposure(conn, fixtures.load_json("exposure.json"))


def _training_builder(conn: psycopg.Connection):
    # Training path: observations from FIXTURES, structure from DB.
    climate = [dict(r) for r in fixtures.load_csv("climate_dekadal.csv")]
    for r in climate:
        for k in ("rain_mm", "rain_anomaly", "ndvi", "ndvi_anomaly"):
            r[k] = float(r[k]) if r[k] not in ("", None) else None
    events = [dict(r) for r in fixtures.load_csv("acled.csv")]
    for e in events:
        e["zone_id"] = e["zone_id"] or None
    adjacency = geo.adjacency_pairs(conn)
    dekads_present = sorted({date.fromisoformat(r["dekad_start"]) for r in climate})
    dekads = enumerate_dekads(dekads_present[0], dekads_present[-1])
    return FeatureBuilder(climate, events, adjacency, dekads)


def test_train_serve_skew_identical(db: psycopg.Connection, tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("DIRA_TILES_DIR", str(tmp_path))
    _bootstrap(db)
    # Inference path: ingest into DB, then build from DB.
    result = pipeline.PipelineResult(cycle=date(2026, 1, 1), cutoff=data_cutoff(date(2026, 1, 1)))
    pipeline.stage_e1_ingest(db, data_cutoff(date(2026, 1, 1)), result)
    serve_builder, zids = features_io.build_feature_builder(db)
    train_builder = _training_builder(db)

    dekad = date(2025, 12, 1)
    cutoff = _cutoff(dekad)
    for zid in zids:
        serve_row = serve_builder.row(zid, dekad, cutoff)
        train_row = train_builder.row(zid, dekad, cutoff)
        assert serve_row == train_row, f"skew for {zid}"
        # NULLs must match exactly too.
        assert [k for k, v in serve_row.items() if v is None] == \
               [k for k, v in train_row.items() if v is None]


def test_model_card_reports_three_baselines() -> None:
    card = json.loads((ARTIFACTS / "model_card.json").read_text())
    baselines = card["metrics"]["baselines"]
    assert set(baselines) == {"persistence_mae", "climatology_mae", "cast_aggregate_mae"}


def test_feature_list_has_no_actor_or_notes_feature() -> None:
    card = json.loads((ARTIFACTS / "model_card.json").read_text())
    banned = ("note", "actor", "ethnic", "clan", "community", "tribe")
    for name in card["feature_list"]:
        assert not any(b in name.lower() for b in banned)
    assert card["feature_list"] == FEATURE_NAMES
