"""Offline training entrypoint (outside the live system).

Produces artifacts/model_v1.lgb + model_card.json and registers a model_versions row.
Reads zone structure + adjacency from the seeded DB and observations from the committed
fixtures (with their fixture ``available_at``). The shared FeatureBuilder guarantees the
training rows are byte-identical to what the pipeline builds at inference.

    uv run python scripts/train.py
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from dira_data import fixtures
from dira_data.db import connect
from dira_data.repositories import geo, models
from dira_features import FEATURE_NAMES, enumerate_dekads
from dira_ml import artifacts as art
from dira_ml.dataset import build_dataset
from dira_ml.train import train

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"


def _load_observations() -> tuple[list[dict], list[dict], list[date]]:
    climate_rows = [dict(r) for r in fixtures.load_csv("climate_dekadal.csv")]
    for r in climate_rows:
        for k in ("rain_mm", "rain_anomaly", "ndvi", "ndvi_anomaly"):
            r[k] = float(r[k]) if r[k] not in ("", None) else None
    events = [dict(r) for r in fixtures.load_csv("acled.csv")]
    for e in events:
        e["zone_id"] = e["zone_id"] or None
        e["fatalities"] = int(e["fatalities"])
    dekads = sorted({date.fromisoformat(r["dekad_start"]) for r in climate_rows})
    dekads = enumerate_dekads(dekads[0], dekads[-1])
    return climate_rows, events, dekads


def run() -> int:
    conn = connect()
    try:
        zids = geo.zone_ids(conn)
        adjacency = geo.adjacency_pairs(conn)
        if not zids:
            print("[train] No zones found — run `make seed` first.", file=sys.stderr)
            return 1
        climate, events, dekads = _load_observations()
        rows = build_dataset(
            climate=climate, events=events, adjacency=adjacency,
            dekads=dekads, zone_ids=zids,
        )
        model = train(rows, FEATURE_NAMES)
        paths = art.save(model, ARTIFACTS)
        with conn.transaction():
            mv_id = models.register(
                conn, kind="lightgbm", path=paths["lgb"],
                feature_list=FEATURE_NAMES, metrics=model.card["metrics"],
            )
        base = model.card["metrics"]["baselines"]
        mae = model.card["metrics"]["incidents_mae"]
        print(f"[train] rows={len(rows)} model_version={mv_id}")
        print(f"[train] incidents_mae={mae:.3f} baselines={base}")
        print(f"[train] artifacts: {paths}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(run())
