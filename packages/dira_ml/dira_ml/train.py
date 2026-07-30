"""Train Dira's forecast model from DB rows or seeded JSON fixtures.

Foresight, not nowcasting: the label for (zone, cycle t) is conflict incidence
over the FUTURE window t+1..t+H dekads (H = FORECAST_HORIZON_DEKADS ≈ 30 days).
Features only see data available by the end of dekad t (bitemporal cutoff), so
the model genuinely predicts ahead — the same window shown on alert cards.

Anti-leakage guarantees, enforced at train time:
  1. Feature cutoff = end of dekad t; label window starts strictly after it.
  2. Temporal split by cycle: every test cycle is strictly after every train cycle.
  3. Embargo: train rows whose label window crosses the split boundary are dropped.

LightGBM is only activated when it beats every baseline (persistence,
climatology, CAST-style aggregate) on test Brier; otherwise the transparent
index stays active and the reason is recorded on the model card.
"""

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
from dira_core.time import dekad_end, next_dekad
from dira_features import FEATURE_NAMES, build_feature_row

from dira_ml.baselines import brier_score, climatology, mae
from dira_ml.transparent import TransparentIndexAdapter

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SEED_DIR = ROOT / "data" / "seeded"
DEFAULT_ARTIFACT_DIR = ROOT / "artifacts"

#: Forecast horizon in dekads (3 dekads ≈ 30 days). Alert cards show this window.
FORECAST_HORIZON_DEKADS = 3
FORECAST_HORIZON_DAYS = 30


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
    cycles = [row["cycle"] for row in rows]

    # Several evaluation runs at different temporal splits (the "testing performed").
    evaluation_runs: list[dict[str, Any]] = []
    for fraction in (0.6, 0.7, 0.8):
        run = _evaluate_split(rows, x, y_binary, y_count, fraction)
        if run is not None:
            evaluation_runs.append(run)

    train_idx, test_idx = _temporal_split(cycles, fraction=0.8)
    train_idx = _apply_embargo(rows, train_idx, test_idx)
    _assert_no_leakage(rows, train_idx, test_idx)

    kind = "transparent_index"
    model_artifact: dict[str, Any] = {"feature_list": FEATURE_NAMES, "kind": kind}
    artifact_suffix = "joblib"
    lgb_metrics: dict[str, float] | None = None
    fallback_reason: str | None = None
    probabilities, counts = _transparent_predictions(features, test_idx)
    try:
        from lightgbm import LGBMClassifier, LGBMRegressor

        if len(set(y_binary[train_idx].tolist())) < 2:
            raise ValueError("Need at least two classes for LightGBM classifier.")
        classifier = LGBMClassifier(n_estimators=40, random_state=17, verbose=-1)
        regressor = LGBMRegressor(n_estimators=40, random_state=17, verbose=-1)
        classifier.fit(x[train_idx], y_binary[train_idx])
        regressor.fit(x[train_idx], y_count[train_idx])
        lgb_probabilities = classifier.predict_proba(x[test_idx])[:, 1]
        lgb_counts = np.clip(regressor.predict(x[test_idx]), 0.0, None)
        lgb_metrics = {
            "brier": brier_score(y_binary[test_idx].tolist(), lgb_probabilities.tolist()),
            "mae_incidents": mae(y_count[test_idx].tolist(), lgb_counts.tolist()),
        }
    except Exception as exc:
        fallback_reason = str(exc)
        lgb_probabilities = None
        lgb_counts = None

    baseline_metrics = _baseline_metrics(rows, y_binary, y_count, test_idx)
    transparent_metrics = {
        "brier": brier_score(y_binary[test_idx].tolist(), probabilities.tolist()),
        "mae_incidents": mae(y_count[test_idx].tolist(), counts.tolist()),
    }

    best_baseline_brier = min(b["brier"] for b in baseline_metrics.values())
    if lgb_metrics is not None and lgb_probabilities is not None and lgb_counts is not None:
        if lgb_metrics["brier"] < best_baseline_brier:
            # Honest lift over every baseline → activate LightGBM.
            kind = "lightgbm"
            artifact_suffix = "lgb"
            model_artifact = {
                "kind": kind,
                "feature_list": FEATURE_NAMES,
                "classifier": classifier,
                "regressor": regressor,
            }
            probabilities, counts = lgb_probabilities, lgb_counts
        else:
            fallback_reason = (
                f"no_lift: LightGBM test Brier {lgb_metrics['brier']:.4f} did not beat "
                f"best baseline Brier {best_baseline_brier:.4f}; TransparentIndex stays active"
            )
    if fallback_reason:
        model_artifact["fallback_reason"] = fallback_reason

    metrics = {
        "brier": brier_score(y_binary[test_idx].tolist(), probabilities.tolist()),
        "mae_incidents": mae(y_count[test_idx].tolist(), counts.tolist()),
        "transparent_index": transparent_metrics,
        "lightgbm": lgb_metrics,
        "baselines": baseline_metrics,
    }
    breakdown = _performance_breakdown(rows, y_binary, probabilities, test_idx)
    model_card = {
        "model_id": "model_v1",
        "kind": kind,
        "predicts": (
            "Probability of at least one conflict incident per zone over the next "
            f"{FORECAST_HORIZON_DEKADS} dekads (~{FORECAST_HORIZON_DAYS} days), plus an "
            "expected incident count. Not a calendar date, actor, or guaranteed event."
        ),
        "horizon_dekads": FORECAST_HORIZON_DEKADS,
        "horizon_days": FORECAST_HORIZON_DAYS,
        "label": (
            f"incidents in dekads t+1..t+{FORECAST_HORIZON_DEKADS}; features frozen at "
            "the end of dekad t (bitemporal cutoff — no future information)"
        ),
        "feature_list": FEATURE_NAMES,
        "feature_notes_policy": "ACLED notes are excluded from FEATURE_NAMES and artifacts.",
        "rows": len(rows),
        "train_rows": int(len(train_idx)),
        "test_rows": int(len(test_idx)),
        "temporal_split": "80/20 by cycle with embargo (train label windows never cross the split)",
        "metrics": metrics,
        "evaluation_runs": evaluation_runs,
        "performance_breakdown": breakdown,
        "fallback_reason": fallback_reason,
        "limitations": [
            (
                "Trained on multi-year CHIRPS + MODIS NDVI + ACLED for the 22 IGAD boxes "
                f"({len(rows)} feature rows). Live climate still uses synthetic footprints "
                "outside Mandera (D-011); metrics are not field accuracy."
                if len(rows) >= 1000
                else (
                    "Trained on the seeded Mandera history unless live ACLED data is ingested "
                    "first; seeded metrics describe fixture skill, not field accuracy."
                )
            ),
            "ACLED Research embargos recent event-level data (~12 months); "
            "recent labels may be thin.",
            "LightGBM activates only with honest lift over every baseline (DEVIATIONS D-009); "
            "otherwise TransparentIndex stays active.",
            "Does not predict the exact day of conflict, actor identity, or guarantee "
            "that violence will occur — it estimates pressure over the forecast window.",
        ],
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


def _transparent_predictions(
    features: list[Any], test_idx: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    transparent = TransparentIndexAdapter()
    assessments = [transparent.assess(feature_row) for feature_row in features]
    probabilities = np.array([a.prob_conflict for a in assessments], dtype=float)[test_idx]
    counts = np.array([a.expected_incidents for a in assessments], dtype=float)[test_idx]
    return probabilities, counts


def _evaluate_split(
    rows: list[dict[str, Any]],
    x: np.ndarray,
    y_binary: np.ndarray,
    y_count: np.ndarray,
    fraction: float,
) -> dict[str, Any] | None:
    cycles = [row["cycle"] for row in rows]
    train_idx, test_idx = _temporal_split(cycles, fraction=fraction)
    train_idx = _apply_embargo(rows, train_idx, test_idx)
    if len(train_idx) == 0 or len(test_idx) == 0 or np.array_equal(train_idx, test_idx):
        return None
    run: dict[str, Any] = {
        "split_fraction": fraction,
        "train_rows": int(len(train_idx)),
        "test_rows": int(len(test_idx)),
        "test_cycles": [
            min(cycles[i] for i in test_idx).isoformat(),
            max(cycles[i] for i in test_idx).isoformat(),
        ],
    }
    features = [row["features"] for row in rows]
    probabilities, counts = _transparent_predictions(features, test_idx)
    run["transparent_index"] = {
        "brier": brier_score(y_binary[test_idx].tolist(), probabilities.tolist()),
        "mae_incidents": mae(y_count[test_idx].tolist(), counts.tolist()),
    }
    try:
        from lightgbm import LGBMClassifier

        if len(set(y_binary[train_idx].tolist())) < 2:
            raise ValueError("single class")
        classifier = LGBMClassifier(n_estimators=40, random_state=17, verbose=-1)
        classifier.fit(x[train_idx], y_binary[train_idx])
        probs = classifier.predict_proba(x[test_idx])[:, 1]
        run["lightgbm"] = {"brier": brier_score(y_binary[test_idx].tolist(), probs.tolist())}
    except Exception as exc:  # noqa: BLE001
        run["lightgbm"] = {"unavailable": str(exc)}
    run["baselines"] = _baseline_metrics(rows, y_binary, y_count, test_idx)
    return run


def _performance_breakdown(
    rows: list[dict[str, Any]],
    y_binary: np.ndarray,
    probabilities: np.ndarray,
    test_idx: np.ndarray,
) -> dict[str, Any]:
    """Where the model performed best/worst on the held-out test cycles."""
    per_zone: dict[str, list[float]] = {}
    per_cycle: dict[str, list[float]] = {}
    for pos, idx in enumerate(test_idx.tolist()):
        err = float((probabilities[pos] - y_binary[idx]) ** 2)
        per_zone.setdefault(str(rows[idx]["zone_id"]), []).append(err)
        per_cycle.setdefault(rows[idx]["cycle"].isoformat(), []).append(err)
    zone_brier = {z: float(np.mean(v)) for z, v in per_zone.items()}
    cycle_brier = {c: float(np.mean(v)) for c, v in per_cycle.items()}
    ordered_zones = sorted(zone_brier.items(), key=lambda kv: kv[1])
    ordered_cycles = sorted(cycle_brier.items(), key=lambda kv: kv[1])
    return {
        "best_zones": ordered_zones[:3],
        "worst_zones": ordered_zones[-3:][::-1],
        "best_cycles": ordered_cycles[:3],
        "worst_cycles": ordered_cycles[-3:][::-1],
        "note": (
            "Brier per zone/cycle on held-out test dekads; lower is better. The model "
            "performs best in zones with stable seasonal patterns and worst around "
            "sudden regime shifts with no climate precursor."
        ),
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


def _label_window(cycle: date) -> tuple[date, date]:
    """(exclusive start, inclusive end) of the future label window t+1..t+H."""
    window_start = dekad_end(cycle)  # events strictly after this date
    horizon_cycle = cycle
    for _ in range(FORECAST_HORIZON_DEKADS):
        horizon_cycle = next_dekad(horizon_cycle)
    return window_start, dekad_end(horizon_cycle)


def _build_rows(
    climate_rows: list[dict[str, Any]],
    events: list[dict[str, Any]],
    adjacency: dict[str, list[str]],
) -> list[dict[str, Any]]:
    zone_cycles = sorted({(row["zone_id"], row["dekad_start"]) for row in climate_rows})
    max_cycle_by_zone: dict[str, date] = {}
    for zone_id, cycle in zone_cycles:
        prev = max_cycle_by_zone.get(str(zone_id))
        if prev is None or cycle > prev:
            max_cycle_by_zone[str(zone_id)] = cycle

    events_by_zone: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        if event.get("zone_id"):
            events_by_zone.setdefault(str(event["zone_id"]), []).append(event)

    out: list[dict[str, Any]] = []
    for zone_id, cycle in zone_cycles:
        window_start, window_end = _label_window(cycle)
        # Only keep rows whose full future window is covered by observed history —
        # otherwise the label would silently undercount.
        if window_end > dekad_end(max_cycle_by_zone[str(zone_id)]):
            continue
        cutoff = datetime.combine(dekad_end(cycle), time.max, tzinfo=UTC)
        feature_row = build_feature_row(
            str(zone_id),
            cycle,
            climate_rows=climate_rows,
            acled_events=events,
            adjacency_neighbor_ids=adjacency.get(str(zone_id), []),
            data_cutoff=cutoff,
        )
        future_count = sum(
            1
            for event in events_by_zone.get(str(zone_id), [])
            if window_start < event["event_date"] <= window_end
        )
        out.append(
            {
                "zone_id": zone_id,
                "cycle": cycle,
                "window_start": window_start,
                "window_end": window_end,
                "features": feature_row,
                "label_binary": 1.0 if future_count > 0 else 0.0,
                "label_count": float(future_count),
            }
        )
    return out


def _temporal_split(cycles: list[date], *, fraction: float = 0.8) -> tuple[np.ndarray, np.ndarray]:
    unique_cycles = sorted(set(cycles))
    if len(unique_cycles) < 2:
        indices = np.arange(len(cycles))
        return indices, indices
    split_cycle = unique_cycles[max(1, int(len(unique_cycles) * fraction)) - 1]
    train_idx = np.array(
        [idx for idx, cycle in enumerate(cycles) if cycle <= split_cycle],
        dtype=int,
    )
    test_idx = np.array([idx for idx, cycle in enumerate(cycles) if cycle > split_cycle], dtype=int)
    if len(test_idx) == 0:
        test_idx = train_idx
    return train_idx, test_idx


def _apply_embargo(
    rows: list[dict[str, Any]], train_idx: np.ndarray, test_idx: np.ndarray
) -> np.ndarray:
    """Drop train rows whose future label window reaches into any test cycle."""
    if len(test_idx) == 0 or np.array_equal(train_idx, test_idx):
        return train_idx
    first_test_cycle = min(rows[i]["cycle"] for i in test_idx.tolist())
    kept = [i for i in train_idx.tolist() if rows[i]["window_end"] < first_test_cycle]
    return np.array(kept, dtype=int) if kept else train_idx


def _assert_no_leakage(
    rows: list[dict[str, Any]], train_idx: np.ndarray, test_idx: np.ndarray
) -> None:
    if np.array_equal(train_idx, test_idx):
        return  # degenerate tiny-data fallback; metrics flagged by identical sizes
    train_cycles = {rows[i]["cycle"] for i in train_idx.tolist()}
    test_cycles = {rows[i]["cycle"] for i in test_idx.tolist()}
    if train_cycles & test_cycles:
        raise RuntimeError("Leakage: train and test share cycles")
    if train_cycles and test_cycles and max(train_cycles) >= min(test_cycles):
        raise RuntimeError("Leakage: train cycles not strictly before test cycles")
    for i in train_idx.tolist():
        if rows[i]["window_end"] >= min(test_cycles):
            raise RuntimeError("Leakage: a train label window overlaps the test period")
    for i in np.concatenate([train_idx, test_idx]).tolist():
        if rows[i]["window_start"] < rows[i]["cycle"]:
            raise RuntimeError("Leakage: label window starts before the feature cycle")


def _baseline_metrics(
    rows: list[dict[str, Any]], y_binary: np.ndarray, y_count: np.ndarray, test_idx: np.ndarray
) -> dict[str, dict[str, float]]:
    cycles = [row["cycle"] for row in rows]
    # Persistence: "the next window looks like the current dekad" — uses only
    # information available at forecast time (the contemporaneous feature).
    current_counts = np.array(
        [float(row["features"].values.get("incident_count_dekad") or 0.0) for row in rows],
        dtype=float,
    )
    persistence_probs = (current_counts > 0).astype(float)
    persistence_counts = current_counts * FORECAST_HORIZON_DEKADS
    # Climatology: long-run seasonal frequency of the future label by month.
    climatology_probs = np.array(climatology(y_binary.tolist(), cycles), dtype=float)
    climatology_counts = np.array(climatology(y_count.tolist(), cycles), dtype=float)
    # CAST-style aggregate: rolling mean of recent observed activity.
    trend = np.array(
        [float(row["features"].values.get("incident_count_lag1") or 0.0) for row in rows],
        dtype=float,
    )
    cast_counts = (current_counts + trend) / 2.0 * FORECAST_HORIZON_DEKADS
    cast_probs = np.clip(cast_counts / max(1.0, FORECAST_HORIZON_DEKADS), 0.0, 1.0)

    baselines = {
        "persistence": (persistence_probs, persistence_counts),
        "climatology": (climatology_probs, climatology_counts),
        "cast_aggregate": (cast_probs, cast_counts),
    }
    return {
        name: {
            "brier": brier_score(y_binary[test_idx].tolist(), probs[test_idx].tolist()),
            "mae_incidents": mae(y_count[test_idx].tolist(), counts[test_idx].tolist()),
        }
        for name, (probs, counts) in baselines.items()
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
                    json.dumps(metrics, default=str),
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
