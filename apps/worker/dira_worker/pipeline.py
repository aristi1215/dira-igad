"""Dekadal pipeline (E1–E7). `python -m dira_worker.pipeline --cycle YYYY-MM-DD`.

Contract:
  * E1–E6 compute; they never write the storefront and make no network call inside a DB
    transaction (invariant 5). Downloads/LLM run OUTSIDE any open transaction.
  * E7 writes the storefront in one SQL-only transaction PER ZONE (invariant: atomic per zone;
    a crash mid-run leaves every visible zone complete or exactly as the previous cycle).
  * Re-running the same cycle yields the same final DB state (invariant 3).
  * Exit code: 0 on success or graceful degradation (LLM failure), != 0 on a real failure.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import psycopg
from dira_data.adapters import factory
from dira_data.db import connect
from dira_data.repositories import climate as climate_repo
from dira_data.repositories import events as events_repo
from dira_data.repositories import geo
from dira_data.repositories import news as news_repo
from dira_data.schema import ensure_schema
from dira_data.tiles import render_layer_tile

from dira_worker.cycle import InvalidCycle, data_cutoff, parse_cycle
from dira_worker.paths import tiles_dir


@dataclass
class PipelineResult:
    cycle: date
    cutoff: datetime
    degraded: bool = False
    warnings: list[str] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)


# --- E1: ingest (downloads happen here, OUTSIDE any DB transaction) -----------------------
def stage_e1_ingest(conn: psycopg.Connection, cutoff: datetime, result: PipelineResult) -> None:
    zone_features = geo.load_zone_features(conn)
    # Fetch (network in live mode) BEFORE opening the write transaction (invariant 5).
    climate_rows = factory.climate_source(zone_features).fetch(cutoff)
    event_rows = factory.event_source().fetch(cutoff)
    news_docs = factory.news_source().fetch(cutoff)

    with conn.transaction():
        climate_repo.upsert_climate(conn, climate_rows)
        events_repo.upsert_events(conn, event_rows)
        events_repo.assign_event_zones(conn)
        for doc in news_docs:
            news_repo.upsert_document(conn, doc)
    result.stats["e1"] = {
        "climate_rows": len(climate_rows),
        "events": len(event_rows),
        "news_docs": len(news_docs),
    }


# --- E2: zonal stats already aggregated per zone; render static PNG tiles ------------------
def stage_e2_tiles(conn: psycopg.Connection, cutoff: datetime, result: PipelineResult) -> None:
    # Zonal aggregation is done by the climate source (seeded: precomputed; live: rasterstats),
    # so E2 here renders the per-layer choropleth tiles from the cutoff-visible values.
    features = {f["properties"]["id"]: f for f in geo.load_zone_features(conn)}
    bounds = geo.cluster_bounds(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (zone_id) zone_id, rain_mm, ndvi
            FROM zone_climate_dekadal
            WHERE rain_available_at <= %s
            ORDER BY zone_id, dekad_start DESC
            """,
            (cutoff,),
        )
        latest = {r["zone_id"]: r for r in cur.fetchall()}

    cycle_str = cutoff.date().isoformat()
    out = tiles_dir()
    written = []
    for layer, col in (("rain", "rain_mm"), ("ndvi", "ndvi")):
        zone_values = [
            (features[zid], (row[col] if row[col] is not None else None))
            for zid, row in latest.items()
            if zid in features
        ]
        if zone_values:
            path = render_layer_tile(out, cycle_str, layer, zone_values, bounds)
            written.append(str(path))
    result.stats["e2"] = {"tiles": written}


def run_pipeline(cycle: date, conn: psycopg.Connection) -> PipelineResult:
    cutoff = data_cutoff(cycle)
    result = PipelineResult(cycle=cycle, cutoff=cutoff)
    stage_e1_ingest(conn, cutoff, result)
    stage_e2_tiles(conn, cutoff, result)
    # E3–E7 are added in M5.
    from dira_worker import stages_late  # local import: added incrementally

    stages_late.run_e3_to_e7(conn, cycle, cutoff, result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dira dekadal pipeline worker")
    parser.add_argument("--cycle", required=True, help="Dekad start YYYY-MM-DD (day 1, 11 or 21)")
    args = parser.parse_args(argv)
    try:
        cycle = parse_cycle(args.cycle)
    except InvalidCycle as exc:
        print(f"[pipeline] {exc}", file=sys.stderr)
        return 2

    conn = connect(autocommit=False)
    try:
        ensure_schema(conn)
        result = run_pipeline(cycle, conn)
    except Exception as exc:  # a real failure (not graceful degradation)
        print(f"[pipeline] FAILED cycle={cycle}: {exc}", file=sys.stderr)
        conn.rollback()
        return 1
    finally:
        conn.close()

    status = "DEGRADED" if result.degraded else "OK"
    print(f"[pipeline] {status} cycle={cycle} stats={result.stats}")
    for w in result.warnings:
        print(f"[pipeline] warning: {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
