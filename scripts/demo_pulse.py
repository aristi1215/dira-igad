"""Demo pulse — a seeded-only feeder that makes the situation room visibly
evolve during a presentation.

It drives the app exclusively through the public HTTP API (the same entry
points a field officer or duty analyst would use), so every red line holds:
field reports are born unverified, alerts are only *drafted* (a human still
has to approve them on the Dispatch screen), and nothing talks to live
providers. SSE picks each change up and the map/situation/dispatch screens
update without a reload.

Run it in its own terminal once the API + dispatch worker are up:

    uv run python -m scripts.demo_pulse            # default ~12 min scenario
    uv run python -m scripts.demo_pulse --fast     # 10x speed for rehearsal

Restart-safe: every step is idempotent (deterministic narratives are deduped
by exact text; alert drafting is skipped when a pending alert already exists).
Refuses to start unless DATA_MODE=seeded.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from typing import Any

import httpx

logging.basicConfig(level=logging.INFO, format="[demo-pulse] %(message)s")
logger = logging.getLogger("demo_pulse")

API = os.environ.get("PULSE_API_BASE", "http://localhost:8000")

# Mandera-first scenario: escalating field reports across the tri-border
# cluster, then a couple of supporting zones elsewhere in IGAD.
SCENARIO: list[dict[str, Any]] = [
    {
        "kind": "report",
        "zone_id": "mandera_ke_north",
        "reporter_role": "water_committee",
        "category": "water_dispute",
        "severity": 2,
        "narrative": "Demo pulse 01: borehole queue doubled; herders arriving from the east.",
    },
    {
        "kind": "report",
        "zone_id": "mandera_ke_north",
        "reporter_role": "chief",
        "category": "pasture_dispute",
        "severity": 2,
        "narrative": "Demo pulse 02: grazing-corridor dispute at boundary cairns; mediation asked.",
    },
    {"kind": "verify", "match": "Demo pulse 01"},
    {
        "kind": "report",
        "zone_id": "mandera_et_east",
        "reporter_role": "ngo_monitor",
        "category": "migration_influx",
        "severity": 3,
        "narrative": "Demo pulse 03: households moving to the river line after losses.",
    },
    {"kind": "verify", "match": "Demo pulse 02"},
    {"kind": "prepare_alert", "zone_id": "mandera_ke_north"},
    {
        "kind": "report",
        "zone_id": "mandera_so_north",
        "reporter_role": "health_worker",
        "category": "market_disruption",
        "severity": 1,
        "narrative": "Demo pulse 04: market attendance thin; road insecurity rumors cited.",
    },
    {"kind": "verify", "match": "Demo pulse 03"},
    {
        "kind": "report",
        "zone_id": "karamoja_cluster",
        "reporter_role": "chief",
        "category": "armed_presence",
        "severity": 1,
        "narrative": "Demo pulse 05: early cattle-camp movement; monitoring.",
    },
    {"kind": "dismiss", "match": "Demo pulse 04"},
]

STEP_SECONDS = 70.0  # ~12 minutes for the full scenario


def _require_seeded(client: httpx.Client) -> None:
    if os.environ.get("DATA_MODE", "seeded") != "seeded":
        sys.exit("demo_pulse refuses to run unless DATA_MODE=seeded")
    sources = client.get(f"{API}/sources").json()
    if sources.get("data_mode") != "seeded":
        sys.exit("API is not running in seeded mode — refusing to feed demo data")


def _find_report(client: httpx.Client, zone_id: str, match: str) -> dict[str, Any] | None:
    reports = client.get(f"{API}/field-reports", params={"zone_id": zone_id}).json()
    for report in reports:
        if match in report.get("narrative", ""):
            return report
    return None


def _step_report(client: httpx.Client, step: dict[str, Any]) -> None:
    existing = _find_report(client, step["zone_id"], step["narrative"][:14])
    if existing:
        logger.info("report already present (%s) — skipping", step["narrative"][:14])
        return
    client.post(
        f"{API}/field-reports",
        json={
            "zone_id": step["zone_id"],
            "reporter_role": step["reporter_role"],
            "category": step["category"],
            "severity": step["severity"],
            "narrative": step["narrative"],
        },
    ).raise_for_status()
    logger.info("field report filed: %s (%s)", step["narrative"][:40], step["zone_id"])


def _step_moderate(client: httpx.Client, step: dict[str, Any], action: str) -> None:
    for scenario_step in SCENARIO:
        if scenario_step.get("narrative", "").startswith(step["match"]):
            zone_id = scenario_step["zone_id"]
            break
    else:
        return
    report = _find_report(client, zone_id, step["match"])
    if report is None:
        logger.info("no report matching %s yet — skipping", step["match"])
        return
    if report["status"] != "unverified":
        logger.info("%s already %s — skipping", step["match"], report["status"])
        return
    client.post(
        f"{API}/field-reports/{report['id']}/{action}",
        json={"verified_by": "demo-duty-officer"},
    ).raise_for_status()
    logger.info("%s report %s", action, step["match"])


def _step_prepare_alert(client: httpx.Client, step: dict[str, Any]) -> None:
    situations = client.get(f"{API}/map/situations").json()
    situation_id = next(
        (
            f["properties"]["situation_id"]
            for f in situations["features"]
            if f["properties"]["zone_id"] == step["zone_id"]
            and f["properties"]["situation_id"]
        ),
        None,
    )
    if situation_id is None:
        logger.info("no open situation for %s — skipping alert draft", step["zone_id"])
        return
    pending = client.get(f"{API}/alerts", params={"status": "pending_approval"})
    if pending.status_code == 200 and any(
        a["situation_id"] == situation_id for a in pending.json()
    ):
        logger.info("pending alert already exists for %s — skipping", step["zone_id"])
        return
    client.post(
        f"{API}/situations/{situation_id}/alert",
        json={"created_by": "demo-pulse", "language": "sw"},
    ).raise_for_status()
    logger.info(
        "alert DRAFTED for %s — it now waits at the human approval gate",
        step["zone_id"],
    )


HEARTBEAT_ZONES = [
    "mandera_ke_north", "mandera_et_east", "mandera_so_north",
    "turkana_west", "karamoja_cluster", "moyale_border",
]
HEARTBEAT_CATEGORIES = [
    "water_dispute", "pasture_dispute", "market_disruption",
    "migration_influx", "peace_meeting",
]


def _heartbeat(client: httpx.Client, tick: int, delay: float) -> None:
    """After the scripted scenario, keep the room breathing: one rotating
    field report per tick (deterministic per tick number, so restarts dedupe),
    verifying the previous tick's report."""
    zone = HEARTBEAT_ZONES[tick % len(HEARTBEAT_ZONES)]
    category = HEARTBEAT_CATEGORIES[tick % len(HEARTBEAT_CATEGORIES)]
    narrative = f"Demo heartbeat {tick:03d}: routine monitor update ({category})."
    _step_report(
        client,
        {
            "zone_id": zone,
            "reporter_role": "field_monitor",
            "category": category,
            "severity": 1 + tick % 2,
            "narrative": narrative,
        },
    )
    if tick > 0:
        prev_zone = HEARTBEAT_ZONES[(tick - 1) % len(HEARTBEAT_ZONES)]
        prev = _find_report(client, prev_zone, f"Demo heartbeat {tick - 1:03d}")
        if prev and prev["status"] == "unverified":
            client.post(
                f"{API}/field-reports/{prev['id']}/verify",
                json={"verified_by": "demo-duty-officer"},
            ).raise_for_status()
            logger.info("heartbeat: verified previous report in %s", prev_zone)
    time.sleep(delay)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fast", action="store_true", help="10x speed (rehearsal)")
    parser.add_argument("--once", action="store_true", help="run all steps immediately")
    parser.add_argument(
        "--loop",
        action="store_true",
        help="after the scenario, keep emitting rotating heartbeat reports",
    )
    args = parser.parse_args()
    delay = 0.0 if args.once else STEP_SECONDS / (10 if args.fast else 1)

    with httpx.Client(timeout=30) as client:
        _require_seeded(client)
        logger.info(
            "starting Mandera-first scenario: %d steps, %.0fs apart (~%.0f min)",
            len(SCENARIO),
            delay,
            len(SCENARIO) * delay / 60,
        )
        for step in SCENARIO:
            if step["kind"] == "report":
                _step_report(client, step)
            elif step["kind"] == "verify":
                _step_moderate(client, step, "verify")
            elif step["kind"] == "dismiss":
                _step_moderate(client, step, "dismiss")
            elif step["kind"] == "prepare_alert":
                _step_prepare_alert(client, step)
            if delay:
                time.sleep(delay)
        logger.info(
            "scenario complete — approve the drafted alert on the Dispatch screen "
            "to watch mock deliveries go out and acknowledgements come back."
        )
        if args.loop and not args.once:
            logger.info("entering heartbeat loop (Ctrl-C to stop)")
            tick = 0
            while True:
                _heartbeat(client, tick, max(delay, 5.0))
                tick += 1


if __name__ == "__main__":
    main()
