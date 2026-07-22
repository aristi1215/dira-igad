"""Train Dira's scaffold model from DB rows or seeded JSON fixtures."""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, date, datetime, time
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import psycopg
from dira_core.time import dekad_end
from dira_features import FEATURE_NAMES, build_feature_row

from dira_ml.baselines import brier_score, cast_aggregate, climatology, mae, persistence
from dira_ml.transparent import TransparentIndexAdapter

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SEED_DIR = ROOT / "data" / "seeded"
DEFAULT_ARTIFACT_DIR = ROOT / "artifacts"


def train(
    *,
    seed_dir: str | Path = DEFAULT_SEED_DIR,
    artifact_dir: str | Path = DEFAULT_ARTIFACT_DIR,
    database_url: str | None = None,
) -> dict[str, Any]:
    db_url = database_url or os.environ.get("DATABASE_URL")
    rows = _load_training_rows(seed_dir=Path(seed_dir), database_url=db_url)
    if not rows:
        raise RuntimeError("No training rows were available from DB or seeded JSON.")

    features = [row["features"] for row in rows]
    y_binary = np.array([row["label_binary"] for row in rows], dtype=float)
    y_count = np.array([row["label_count"] for row in rows], dtype=float)
    x = np.array(
        [
            [_nan_for_none(feature_row.values.get(name)) for name in FEATURE_NAMES]
            for feature_row in features
        ],
        dtype=float,
    )
    train_idx, test_idx = _temporal_split([row["cycle"] for row in rows])

    kind = "transparent_index"
    model_artifact: dict[str, Any] = {"feature_list": FEATURE_NAMES, "kind": kind}
    artifact_suffix = "joblib"
    try:
        from lightgbm import LGBMClassifier, LGBMRegressor

        if len(set(y_binary[train_idx].tolist())) < 2:
            raise ValueError("Need at least two classes for LightGBM classifier.")
        classifier = LGBMClassifier(n_estimators=40, random_state=17, verbose=-1)
        regressor = LGBMRegressor(n_estimators=40, random_state=17, verbose=-1)
        classifier.fit(x[train_idx], y_binary[train_idx])
        regressor.fit(x[train_idx], y_count[train_idx])
        probabilities = classifier.predict_proba(x[test_idx])[:, 1]
        counts = regressor.predict(x[test_idx])
        kind = "lightgbm"
        artifact_suffix = "lgb"
        model_artifact = {
            "kind": kind,
            "feature_list": FEATURE_NAMES,
            "classifier": classifier,
            "regressor": regressor,
        }
    except Exception as exc:
        transparent = TransparentIndexAdapter()
        assessments = [transparent.assess(feature_row) for feature_row in features]
        probabilities = np.array(
            [assessment.prob_conflict for assessment in assessments],
            dtype=float,
        )[test_idx]
        counts = np.array(
            [assessment.expected_incidents for assessment in assessments],
            dtype=float,
        )[test_idx]
        model_artifact["fallback_reason"] = str(exc)

    baseline_metrics = _baseline_metrics(rows, y_binary, y_count, test_idx)
    metrics = {
        "brier": brier_score(y_binary[test_idx].tolist(), probabilities.tolist()),
        "mae_incidents": mae(y_count[test_idx].tolist(), counts.tolist()),
        "baselines": baseline_metrics,
    }
    model_card = {
        "model_id": "model_v1",
        "kind": kind,
        "feature_list": FEATURE_NAMES,
        "feature_notes_policy": "ACLED notes are excluded from FEATURE_NAMES and artifacts.",
        "rows": len(rows),
        "train_rows": int(len(train_idx)),
        "test_rows": int(len(test_idx)),
        "metrics": metrics,
    }

    artifact_root = Path(artifact_dir)
    artifact_root.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_root / f"model_v1.{artifact_suffix}"
    joblib.dump(model_artifact, artifact_path)
    model_card_path = artifact_root / "model_card.json"
    model_card_path.write_text(json.dumps(model_card, indent=2, default=str), encoding="utf-8")

    if db_url:
        _upsert_model_version(db_url, kind, artifact_path, metrics, model_card)

    return {
        "kind": kind,
        "artifact_path": str(artifact_path),
        "model_card_path": str(model_card_path),
    }


def _load_training_rows(seed_dir: Path, database_url: str | None) -> list[dict[str, Any]]:
    if database_url:
        try:
            return _load_training_rows_from_db(database_url)
        except Exception:
            pass
    return _load_training_rows_from_json(seed_dir)


def _load_training_rows_from_db(database_url: str) -> list[dict[str, Any]]:
    with psycopg.connect(database_url) as conn:
        climate_rows = _fetch_dicts(
            conn,
            """
            SELECT zone_id, dekad_start, rain_mm, rain_available_at, ndvi_mean, ndvi_available_at
            FROM zone_climate_dekadal
            ORDER BY zone_id, dekad_start
            """,
        )
        events = _fetch_dicts(
            conn,
            """
            SELECT event_id, event_date, zone_id, event_type, fatalities, available_at
            FROM acled_events
            ORDER BY event_date, event_id
            """,
        )
        adjacency_rows = _fetch_dicts(
            conn,
            "SELECT zone_id, neighbor_id FROM zone_adjacency ORDER BY zone_id, neighbor_id",
        )
    adjacency = _adjacency_map(adjacency_rows)
    return _build_rows(climate_rows, events, adjacency)


def _load_training_rows_from_json(seed_dir: Path) -> list[dict[str, Any]]:
    climate_rows = [
        {
            **row,
            "dekad_start": _parse_date(row["dekad_start"]),
            "rain_available_at": _parse_datetime(row["rain_available_at"]),
            "ndvi_available_at": _parse_datetime(row["ndvi_available_at"]),
        }
        for row in _read_json(seed_dir / "mandera" / "climate" / "climate.json")
    ]
    events = [
        {
            **row,
            "event_date": _parse_date(row["event_date"]),
            "available_at": _parse_datetime(row["available_at"]),
        }
        for row in _read_json(seed_dir / "mandera" / "acled" / "events.json")
    ]
    return _build_rows(climate_rows, events, {})


def _build_rows(
    climate_rows: list[dict[str, Any]],
    events: list[dict[str, Any]],
    adjacency: dict[str, list[str]],
) -> list[dict[str, Any]]:
    zone_cycles = sorted({(row["zone_id"], row["dekad_start"]) for row in climate_rows})
    out: list[dict[str, Any]] = []
    for zone_id, cycle in zone_cycles:
        cutoff = datetime.combine(dekad_end(cycle), time.max, tzinfo=UTC)
        feature_row = build_feature_row(
            str(zone_id),
            cycle,
            climate_rows=climate_rows,
            acled_events=events,
            adjacency_neighbor_ids=adjacency.get(str(zone_id), []),
            data_cutoff=cutoff,
        )
        incident_count = float(feature_row.values["incident_count_dekad"] or 0.0)
        out.append(
            {
                "zone_id": zone_id,
                "cycle": cycle,
                "features": feature_row,
                "label_binary": 1.0 if incident_count > 0 else 0.0,
                "label_count": incident_count,
            }
        )
    return out


def _temporal_split(cycles: list[date]) -> tuple[np.ndarray, np.ndarray]:
    unique_cycles = sorted(set(cycles))
    if len(unique_cycles) < 2:
        indices = np.arange(len(cycles))
        return indices, indices
    split_cycle = unique_cycles[max(1, int(len(unique_cycles) * 0.8)) - 1]
    train_idx = np.array(
        [idx for idx, cycle in enumerate(cycles) if cycle <= split_cycle],
        dtype=int,
    )
    test_idx = np.array([idx for idx, cycle in enumerate(cycles) if cycle > split_cycle], dtype=int)
    if len(test_idx) == 0:
        test_idx = train_idx
    return train_idx, test_idx


def _baseline_metrics(
    rows: list[dict[str, Any]], y_binary: np.ndarray, y_count: np.ndarray, test_idx: np.ndarray
) -> dict[str, dict[str, float]]:
    cycles = [row["cycle"] for row in rows]
    count_values = y_count.tolist()
    binary_values = y_binary.tolist()
    baselines = {
        "persistence": persistence(binary_values),
        "climatology": climatology(binary_values, cycles),
        "cast_aggregate": cast_aggregate(count_values),
    }
    return {
        name: {
            "brier": brier_score(y_binary[test_idx].tolist(), np.array(preds)[test_idx].tolist()),
            "mae_incidents": mae(y_count[test_idx].tolist(), np.array(preds)[test_idx].tolist()),
        }
        for name, preds in baselines.items()
    }


def _upsert_model_version(
    database_url: str,
    kind: str,
    artifact_path: Path,
    metrics: dict[str, Any],
    model_card: dict[str, Any],
) -> None:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE model_versions SET is_active = FALSE WHERE is_active")
            cur.execute(
                """
                INSERT INTO model_versions (
                  id, kind, artifact_path, feature_list, metrics, model_card, is_active
                )
                VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, TRUE)
                ON CONFLICT (id) DO UPDATE
                SET kind = EXCLUDED.kind,
                    artifact_path = EXCLUDED.artifact_path,
                    feature_list = EXCLUDED.feature_list,
                    metrics = EXCLUDED.metrics,
                    model_card = EXCLUDED.model_card,
                    is_active = TRUE
                """,
                (
                    "model_v1",
                    kind,
                    str(artifact_path),
                    json.dumps(FEATURE_NAMES),
                    json.dumps(metrics),
                    json.dumps(model_card, default=str),
                ),
            )


def _fetch_dicts(conn: psycopg.Connection[Any], sql: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql)
        names = [column.name for column in cur.description or []]
        return [dict(zip(names, row, strict=True)) for row in cur.fetchall()]


def _adjacency_map(rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    adjacency: dict[str, list[str]] = {}
    for row in rows:
        adjacency.setdefault(str(row["zone_id"]), []).append(str(row["neighbor_id"]))
    return adjacency


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _nan_for_none(value: float | None) -> float:
    return float("nan") if value is None else float(value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-dir", default=str(DEFAULT_SEED_DIR))
    parser.add_argument("--artifact-dir", default=str(DEFAULT_ARTIFACT_DIR))
    args = parser.parse_args()
    result = train(seed_dir=args.seed_dir, artifact_dir=args.artifact_dir)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
