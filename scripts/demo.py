"""Run three consecutive seeded pipeline cycles for the demo timeline."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CYCLES = ("2026-02-21", "2026-03-01", "2026-03-11")


def _activate_transparent_index(database_url: str) -> None:
    import json

    import psycopg
    from dira_features import FEATURE_NAMES

    card = {
        "model_id": "transparent_v1",
        "kind": "transparent_index",
        "feature_list": FEATURE_NAMES,
        "note": "Pinned active for seeded Mandera demo (DIRA-SPEC demo script).",
    }
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE model_versions SET is_active = FALSE")
            cur.execute(
                """
                INSERT INTO model_versions (
                  id, kind, artifact_path, feature_list, metrics, model_card, is_active
                ) VALUES (
                  %s, 'transparent_index', NULL, %s::jsonb, '{}'::jsonb, %s::jsonb, TRUE
                )
                ON CONFLICT (id) DO UPDATE SET
                  feature_list = EXCLUDED.feature_list,
                  model_card = EXCLUDED.model_card,
                  is_active = TRUE
                """,
                ("transparent_v1", json.dumps(FEATURE_NAMES), json.dumps(card)),
            )
        conn.commit()
    print("[demo] active model=transparent_v1")


def main() -> int:
    env = os.environ.copy()
    env.setdefault("DATA_MODE", "seeded")
    env.setdefault("DATABASE_URL", "postgresql://dira:dira@localhost:5432/dira")

    # Train for model card / baselines, then pin transparent_index as active for the
    # seeded Mandera demo so operational bands reliably open situations.
    from dira_ml.train import train

    try:
        result = train(database_url=env["DATABASE_URL"], seed_dir=ROOT / "data" / "seeded")
        print(f"[demo] model trained kind={result.get('kind')}")
    except Exception as exc:  # noqa: BLE001
        print(f"[demo] train skipped/failed ({exc}); transparent index will be used")

    _activate_transparent_index(env["DATABASE_URL"])

    for cycle in CYCLES:
        print(f"[demo] running pipeline cycle={cycle}")
        proc = subprocess.run(
            [sys.executable, "-m", "dira_worker.pipeline", "--cycle", cycle],
            cwd=ROOT,
            env=env,
            check=False,
        )
        if proc.returncode != 0:
            print(f"[demo] pipeline failed for {cycle} exit={proc.returncode}", file=sys.stderr)
            return proc.returncode

    print("[demo] Seeded demo ready.")
    print("[demo] Script: red zone -> Tabiri -> advisor -> approve -> mock call -> ack -> green.")
    print("[demo] Start: uv run uvicorn dira_api.main:app --port 8000")
    print("[demo]        uv run python -m dira_worker.dispatch")
    print("[demo]        npm --prefix apps/web run dev -- --host 0.0.0.0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
