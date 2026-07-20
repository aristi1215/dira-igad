"""The three honest baselines the model card must beat (or report against) — ADR 19.

* Persistence — next-dekad incidents = last observed dekad's incidents.
* Climatology — long-run seasonal mean incidents per zone × dekad-of-year.
* CAST aggregate — a conflict-forecast-style baseline: the trailing mean rate aggregated to a
  coarser (CAST-like) grain, applied uniformly to that grain's zones.

Each returns a predicted expected-incidents series aligned to the eval rows.
"""

from __future__ import annotations

from collections import defaultdict

from dira_features.dekads import dekad_of_year_index


def persistence(rows: list[dict]) -> list[float]:
    """Predict incidents_lag1 (the last observed dekad) as the next value."""
    return [float(r["features"].get("incidents_lag1") or 0.0) for r in rows]


def climatology(train_rows: list[dict], eval_rows: list[dict]) -> list[float]:
    """Mean training incidents per (zone, dekad-of-year)."""
    sums: dict[tuple[str, int], float] = defaultdict(float)
    counts: dict[tuple[str, int], int] = defaultdict(int)
    for r in train_rows:
        key = (r["zone_id"], dekad_of_year_index(r["dekad"]))
        sums[key] += r["incidents"]
        counts[key] += 1
    global_mean = (sum(r["incidents"] for r in train_rows) / len(train_rows)) if train_rows else 0.0
    out = []
    for r in eval_rows:
        key = (r["zone_id"], dekad_of_year_index(r["dekad"]))
        out.append(sums[key] / counts[key] if counts[key] else global_mean)
    return out


def cast_aggregate(train_rows: list[dict], eval_rows: list[dict], grain: int = 3) -> list[float]:
    """Trailing mean incident rate aggregated to a CAST-like coarse grain.

    ``grain`` groups zones by a prefix of their id (proxy for the coarser CAST admin unit).
    """
    def unit(zone_id: str) -> str:
        return "_".join(zone_id.split("_")[:grain])

    sums: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    for r in train_rows:
        sums[unit(r["zone_id"])] += r["incidents"]
        counts[unit(r["zone_id"])] += 1
    global_mean = (sum(r["incidents"] for r in train_rows) / len(train_rows)) if train_rows else 0.0
    return [
        sums[unit(r["zone_id"])] / counts[unit(r["zone_id"])]
        if counts[unit(r["zone_id"])] else global_mean
        for r in eval_rows
    ]
