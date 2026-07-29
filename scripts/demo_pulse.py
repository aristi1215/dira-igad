"""Demo pulse — a seeded-only driver that exercises the *whole* situation room
by continuously feeding it lifelike activity during a presentation.

Every tick the pulse makes the room visibly evolve across all four data flows:

  * field reports      — new officer/chief/monitor reports (public HTTP API)
  * corroboration      — verifies the previous tick's report so it starts
                         contributing on the next cycle
  * news signals       — injects fresh media/humanitarian signals so the news
                         panel and situation dossiers update (direct DB write)
  * alerts + dispatch  — periodically drafts an alert and, when asked, walks it
                         through the human-approval gate and out to real
                         deliveries (mock or Twilio, whatever the server runs),
                         then reports how each delivery progressed

Data is driven through the same public HTTP API a duty analyst would use, plus
a thin direct-DB channel for the two things the API deliberately has no public
mutation endpoint for (seeding news signals and pointing the recipient roster
at a demo phone). It refuses to run unless the API is in ``DATA_MODE=seeded`` —
the dispatch channel (mock vs. Twilio) is independent and is whatever the
server was started with, so this same script drives a real Twilio call on the
deployed box.

Typical use, in its own terminal once the API + dispatch worker are up::

    # gentle live feed for a demo screen (reports + news + periodic alerts)
    uv run python -m scripts.demo_pulse --loop

    # rehearsal: 10x faster
    uv run python -m scripts.demo_pulse --loop --fast

    # one full pass immediately (no waiting) — good for a smoke test
    uv run python -m scripts.demo_pulse --once

    # ALSO push approved alerts all the way to real dispatch, calling a number
    # (server must be in DISPATCH_MODE=twilio for a real call; mock otherwise).
    # This repoints the recipient roster at the given number so only it is dialed.
    uv run python -m scripts.demo_pulse --loop --call-number +16723809940

Safety:
  * refuses to start unless the API reports DATA_MODE=seeded;
  * alerts are only auto-approved when you pass --dispatch or --call-number;
    the approval still goes through the real /approve endpoint with a named
    approver, so the database human-gate constraint is genuinely satisfied;
  * without --dispatch the pulse only *drafts* alerts and stops at the gate,
    exactly like the original behaviour.
"""

from __future__ import annotations

import argparse
import logging
import os
import random
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

logging.basicConfig(level=logging.INFO, format="[demo-pulse] %(message)s")
logger = logging.getLogger("demo_pulse")
# httpx logs every request at INFO; that drowns the pulse's own narration.
logging.getLogger("httpx").setLevel(logging.WARNING)

API = os.environ.get("PULSE_API_BASE", "http://localhost:8000")

APPROVER = "Demo Pulse (duty officer)"
DEMO_RECIPIENT_NAME = "Demo Pulse recipient"

# ---------------------------------------------------------------------------
# Content templates — realistic, rotating, so the feed never looks canned.
# ---------------------------------------------------------------------------

# Field-report flavour. Each is (reporter_role, category, severity, template).
# {loc} is filled with a human place name for the zone.
REPORT_TEMPLATES: list[tuple[str, str, int, str]] = [
    ("water_committee", "water_dispute", 2,
     "Borehole queue near {loc} more than doubled overnight; herders arriving from the east."),
    ("chief", "pasture_dispute", 2,
     "Grazing-corridor dispute at the {loc} boundary cairns; elders asking for mediation."),
    ("ngo_monitor", "migration_influx", 3,
     "Households moving toward the {loc} river line after livestock losses this dekad."),
    ("health_worker", "market_disruption", 1,
     "Market attendance at {loc} thin today; traders cite road-insecurity rumours."),
    ("chief", "armed_presence", 2,
     "Unusual armed movement reported north of {loc}; community requests a monitoring visit."),
    ("field_monitor", "road_blockage", 2,
     "Main track into {loc} blocked by a stand-off since morning; detour adds three hours."),
    ("peace_committee", "peace_meeting", 1,
     "Cross-border peace meeting convened at {loc}; both sides agreed a watering schedule."),
    ("water_committee", "livestock_raid", 3,
     "Livestock raid reported outside {loc} overnight; several animals taken, no casualties yet."),
    ("ngo_monitor", "migration_influx", 2,
     "New arrivals camping on the edge of {loc}; shelter and water already stretched."),
]

# News-signal flavour. Each is (signal_type, source, title, body, confidence).
NEWS_TEMPLATES: list[tuple[str, str, str, str, float]] = [
    ("resource_competition", "Tri-Border Bulletin",
     "Water queues lengthen around {loc} grazing corridors",
     "Monitors report longer queues at boreholes near {loc} and more livestock moving toward "
     "shared dry-season corridors, raising the risk of friction between herding groups.",
     0.62),
    ("displacement", "Regional Humanitarian Wire",
     "Fresh displacement reported near {loc}",
     "Aid workers describe households leaving settlements around {loc} after repeated livestock "
     "losses; local officials are requesting emergency water trucking and shelter support.",
     0.58),
    ("armed_activity", "Frontier Monitor",
     "Security incident disrupts movement near {loc}",
     "A localized security incident near {loc} briefly closed a key route. Authorities urged "
     "residents to use neutral mediation channels and report blocked corridors.",
     0.55),
    ("market_stress", "East Africa Markets Desk",
     "Livestock volumes fall at {loc} market",
     "Traders at the {loc} market say volumes are well below normal after several dry weeks, "
     "pushing staple prices up and squeezing pastoralist incomes.",
     0.49),
    ("mediation", "Peace Actors Network",
     "Elders broker watering-schedule truce near {loc}",
     "Community elders around {loc} agreed a rotating watering schedule to ease pressure at "
     "contested boreholes, a de-escalation step monitors will track over the coming dekad.",
     0.44),
]

# Human place names per zone, used to make narratives feel located.
ZONE_PLACES: dict[str, str] = {
    "mandera_ke_north": "Mandera North",
    "mandera_ke_south": "Mandera South",
    "mandera_et_east": "Dolo Ado",
    "mandera_et_west": "Suftu",
    "mandera_so_north": "Belet Hawa",
    "mandera_so_south": "Luuq",
    "karamoja_cluster": "Kaabong",
    "turkana_west": "Kakuma",
    "moyale_border": "Moyale",
    "marsabit_frontier": "Marsabit",
    "jubaland_coast": "Kismayo",
    "jubaland_inland": "Bardhere",
    "gambella_lowlands": "Gambella",
}


def _place(zone_id: str) -> str:
    return ZONE_PLACES.get(zone_id, zone_id.replace("_", " ").title())


# ---------------------------------------------------------------------------
# Running tally, printed so the operator can see the room breathing.
# ---------------------------------------------------------------------------
@dataclass
class Counters:
    reports: int = 0
    verified: int = 0
    news: int = 0
    alerts_drafted: int = 0
    alerts_approved: int = 0
    deliveries: int = 0
    calls: int = 0
    errors: int = 0

    def line(self) -> str:
        return (
            f"reports={self.reports} verified={self.verified} news={self.news} "
            f"drafted={self.alerts_drafted} approved={self.alerts_approved} "
            f"deliveries={self.deliveries} errors={self.errors}"
        )


# ---------------------------------------------------------------------------
# Optional direct-DB channel (news signals + demo recipient). Guarded so the
# pulse still runs its HTTP-only flows if psycopg / the DB are unavailable.
# ---------------------------------------------------------------------------
class DBChannel:
    def __init__(self, database_url: str | None) -> None:
        self._url = database_url
        self._enabled = False
        self._connect = None
        if not database_url:
            logger.warning(
                "no DATABASE_URL — news injection and --call-number roster setup disabled "
                "(field reports, verification and alert drafting still run over HTTP)"
            )
            return
        try:
            from dira_data.db import connect  # local import; keeps HTTP-only mode dependency-free

            # Probe once so we fail loud & early rather than mid-loop.
            with connect(database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            self._connect = connect
            self._enabled = True
        except Exception as exc:  # noqa: BLE001 — degrade gracefully for a demo tool
            logger.warning("DB channel unavailable (%s) — news/roster features disabled", exc)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def inject_news(
        self,
        zone_id: str,
        cycle: date,
        run_tag: str,
        index: int,
        confidence: float | None = None,
        available_at: datetime | None = None,
    ) -> bool:
        """Insert one news document + unconfirmed signal for a zone."""
        if not self._enabled or self._connect is None:
            return False
        signal_type, source, title_t, body_t, template_confidence = random.choice(
            NEWS_TEMPLATES
        )
        signal_confidence = (
            template_confidence if confidence is None else max(0.0, min(1.0, confidence))
        )
        loc = _place(zone_id)
        title = title_t.format(loc=loc)
        body = body_t.format(loc=loc)
        external_id = f"demo-pulse-{run_tag}-news-{index:04d}"
        published_at = available_at or datetime.now(UTC)
        try:
            with self._connect(self._url) as conn:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            INSERT INTO news_documents (
                              external_id, title, body, source, published_at, available_at
                            ) VALUES (%s, %s, %s, %s, %s, %s)
                            ON CONFLICT (external_id) DO NOTHING
                            RETURNING id
                            """,
                            (
                                external_id,
                                title,
                                body,
                                source,
                                published_at,
                                published_at,
                            ),
                        )
                        row = cur.fetchone()
                        if row is None:
                            return False  # already injected (restart-safe)
                        document_id = row["id"]
                        cur.execute(
                            """
                            INSERT INTO news_signals (
                              document_id, zone_id, signal_type, confidence, status,
                              excerpt, cycle
                            ) VALUES (%s, %s, %s, %s, 'unconfirmed', %s, %s)
                            """,
                            (
                                document_id,
                                zone_id,
                                signal_type,
                                signal_confidence,
                                body[:280],
                                cycle,
                            ),
                        )
            logger.info("  news  signal injected: %s (%s)", title, zone_id)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("  news injection failed for %s: %s", zone_id, exc)
            return False

    def insert_field_report(
        self,
        zone_id: str,
        reporter_role: str,
        category: str,
        severity: int,
        narrative: str,
        reported_at: datetime,
    ) -> str | None:
        """Insert an unverified, bitemporally positioned field report."""
        if not self._enabled or self._connect is None:
            return None
        try:
            with self._connect(self._url) as conn:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            INSERT INTO field_reports (
                              zone_id, reporter_role, category, severity, narrative,
                              reported_at, status, available_at
                            ) VALUES (%s, %s, %s, %s, %s, %s, 'unverified', %s)
                            RETURNING id
                            """,
                            (
                                zone_id,
                                reporter_role,
                                category,
                                severity,
                                narrative,
                                reported_at,
                                reported_at,
                            ),
                        )
                        row = cur.fetchone()
            return str(row["id"]) if row else None
        except Exception as exc:  # noqa: BLE001
            logger.warning("  field-report DB insert failed for %s: %s", zone_id, exc)
            return None

    def point_roster_at(self, phone: str, zone_id: str | None) -> bool:
        """Make ``phone`` the single active voice recipient (deactivate the rest)
        so an approved alert dials exactly one number — the demo phone."""
        if not self._enabled or self._connect is None:
            return False
        try:
            with self._connect(self._url) as conn:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute("UPDATE recipients SET active = FALSE WHERE active = TRUE")
                        cur.execute(
                            "SELECT id FROM recipients WHERE phone_e164 = %s LIMIT 1",
                            (phone,),
                        )
                        existing = cur.fetchone()
                        if existing:
                            cur.execute(
                                """
                                UPDATE recipients
                                SET active = TRUE, channel = 'voice', language = 'sw',
                                    zone_id = %s, name = %s
                                WHERE id = %s
                                """,
                                (zone_id, DEMO_RECIPIENT_NAME, existing["id"]),
                            )
                        else:
                            cur.execute(
                                """
                                INSERT INTO recipients (
                                  name, phone_e164, zone_id, channel, language, active
                                ) VALUES (%s, %s, %s, 'voice', 'sw', TRUE)
                                """,
                                (DEMO_RECIPIENT_NAME, phone, zone_id),
                            )
            logger.info(
                "recipient roster pointed at %s (zone=%s) — only this number will be dialed",
                phone, zone_id or "all zones",
            )
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not point roster at %s: %s", phone, exc)
            return False


# ---------------------------------------------------------------------------
# HTTP helpers.
# ---------------------------------------------------------------------------
def _require_seeded(client: httpx.Client) -> None:
    if os.environ.get("DATA_MODE", "seeded") != "seeded":
        sys.exit("demo_pulse refuses to run unless DATA_MODE=seeded")
    try:
        sources = client.get(f"{API}/sources").json()
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"cannot reach API at {API} ({exc}) — start the API first")
    if sources.get("data_mode") != "seeded":
        sys.exit("API is not running in seeded mode — refusing to feed demo data")


def _situation_zones(client: httpx.Client) -> list[dict[str, Any]]:
    """Zones that currently have an open situation, hottest first."""
    fc = client.get(f"{API}/map/situations").json()
    rows = [
        f["properties"]
        for f in fc.get("features", [])
        if f["properties"].get("situation_id")
    ]
    rows.sort(key=lambda p: (p.get("model_risk") or 0), reverse=True)
    return rows


def _latest_cycle(zones: list[dict[str, Any]]) -> date:
    cycles = [z.get("cycle") for z in zones if z.get("cycle")]
    parsed = []
    for c in cycles:
        try:
            parsed.append(date.fromisoformat(str(c)[:10]))
        except ValueError:
            continue
    base = max(parsed) if parsed else date.today()
    # One day past the latest assessment so new signals sort to the top.
    return base + timedelta(days=1)


def _file_report(client: httpx.Client, zone_id: str, run_tag: str, index: int,
                 counters: Counters) -> str | None:
    role, category, severity, template = random.choice(REPORT_TEMPLATES)
    narrative = f"DP-{run_tag}-{index:04d}: {template.format(loc=_place(zone_id))}"
    try:
        client.post(
            f"{API}/field-reports",
            json={
                "zone_id": zone_id,
                "reporter_role": role,
                "category": category,
                "severity": severity,
                "narrative": narrative,
            },
        ).raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("  report failed for %s: %s", zone_id, exc)
        counters.errors += 1
        return None
    counters.reports += 1
    logger.info("  report filed: %s [%s sev%d] (%s)", category, role, severity, zone_id)
    return narrative


def _verify_report(client: httpx.Client, zone_id: str, narrative: str,
                   counters: Counters) -> None:
    """Verify a specific just-filed report (named-human corroboration gate)."""
    if not narrative:
        return
    tag = narrative.split(":", 1)[0]
    try:
        reports = client.get(f"{API}/field-reports", params={"zone_id": zone_id}).json()
    except httpx.HTTPError:
        return
    match = next((r for r in reports if r.get("narrative", "").startswith(tag)
                  and r.get("status") == "unverified"), None)
    if match is None:
        return
    try:
        client.post(
            f"{API}/field-reports/{match['id']}/verify",
            json={"verified_by": "demo-duty-officer"},
        ).raise_for_status()
        counters.verified += 1
        logger.info("  report verified: %s (%s)", tag, zone_id)
    except httpx.HTTPError:
        pass


def _verify_report_id(
    client: httpx.Client,
    zone_id: str,
    report_id: str,
    counters: Counters,
) -> None:
    try:
        client.post(
            f"{API}/field-reports/{report_id}/verify",
            json={"verified_by": "demo-duty-officer"},
        ).raise_for_status()
        counters.verified += 1
        logger.info("  report verified: %s (%s)", report_id[:8], zone_id)
    except httpx.HTTPError as exc:
        logger.warning("  report verification failed for %s: %s", zone_id, exc)


def _draft_alert(client: httpx.Client, zone: dict[str, Any],
                 counters: Counters) -> str | None:
    situation_id = zone.get("situation_id")
    if not situation_id:
        return None
    try:
        resp = client.post(
            f"{API}/situations/{situation_id}/alert",
            json={"created_by": "demo-pulse", "language": "sw"},
            timeout=120.0,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("  alert draft failed for %s: %s", zone.get("zone_id"), exc)
        counters.errors += 1
        return None
    counters.alerts_drafted += 1
    alert_id = resp.json().get("id")
    logger.info(
        "  alert DRAFTED for %s — waiting at the human approval gate",
        zone.get("zone_id"),
    )
    return alert_id


def _approve_and_dispatch(client: httpx.Client, alert_id: str, zone_id: str,
                          call_number: str | None, counters: Counters) -> None:
    """Simulate the duty officer approving on the Dispatch screen. The approval
    hits the real /approve endpoint with a named approver, so the DB human-gate
    constraint genuinely holds; approval atomically creates the deliveries the
    worker then dispatches (mock or Twilio)."""
    try:
        client.post(
            f"{API}/alerts/{alert_id}/approve",
            json={"approved_by": APPROVER},
        ).raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("  approve failed for alert %s: %s", alert_id, exc)
        counters.errors += 1
        return
    counters.alerts_approved += 1
    logger.info("  alert APPROVED by %r — deliveries created", APPROVER)
    _report_deliveries(client, alert_id, call_number, counters)


def _report_deliveries(client: httpx.Client, alert_id: str, call_number: str | None,
                       counters: Counters) -> None:
    """Poll the deliveries for this alert briefly so the operator sees the
    dispatch outcome narrated (queued -> sent -> delivered / failed)."""
    seen: dict[str, str] = {}
    counted = False
    for _ in range(12):  # ~24s of observation
        try:
            rows = [d for d in client.get(f"{API}/deliveries").json()
                    if d.get("alert_id") == alert_id]
        except httpx.HTTPError:
            break
        if rows and not counted:
            counters.deliveries += len(rows)
            if call_number:
                counters.calls += sum(1 for d in rows if d.get("channel") == "voice")
            counted = True
        for d in rows:
            status = d.get("status", "?")
            if seen.get(d["id"]) != status:
                seen[d["id"]] = status
                extra = ""
                if d.get("provider_message_id"):
                    extra = f" sid={d['provider_message_id']}"
                if d.get("last_error"):
                    extra = f" error={d['last_error']}"
                logger.info(
                    "  delivery %s: %s%s%s",
                    d["id"][:8], d.get("channel", "?"), f" -> {status}", extra,
                )
        if rows and all(d.get("status") in ("delivered", "failed", "needs_review")
                        for d in rows):
            break
        time.sleep(2.0)
    if call_number and counted:
        logger.info(
            "  ^ a real call goes to %s only if the server runs DISPATCH_MODE=twilio",
            call_number,
        )


def _open_situation_naturally(
    client: httpx.Client,
    db: DBChannel,
    args: argparse.Namespace,
    run_tag: str,
    counters: Counters,
) -> None:
    """Use current-cycle corroboration and the real pipeline to open a situation."""
    if not db.enabled:
        logger.warning(
            "natural escalation unavailable — DB channel is disabled; "
            "continuing with HTTP-only behavior"
        )
        return

    try:
        from dira_core.time import dekad_end
        from dira_data.db import connect
        from dira_worker.pipeline import stage_e4_e7
        from dira_worker.settings import get_settings
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "natural escalation unavailable — worker/data packages could not load: %s",
            exc,
        )
        return

    try:
        with connect(args.db_url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT max(cycle) AS cycle FROM assessments")
                row = cur.fetchone()
        cycle = row["cycle"] if row else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("natural escalation unavailable — could not find latest cycle: %s", exc)
        return
    if cycle is None:
        logger.warning("natural escalation unavailable — no existing assessment cycle")
        return
    cutoff = dekad_end(cycle)
    report_time = datetime.combine(
        cutoff - timedelta(days=5),
        datetime.min.time(),
        tzinfo=UTC,
    ).replace(hour=12)

    def _run_model() -> None:
        try:
            with connect(args.db_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT zone_id, max(confidence) AS confidence
                        FROM news_signals
                        WHERE cycle = %s
                        GROUP BY zone_id
                        """,
                        (cycle,),
                    )
                    corroboration = {
                        str(row["zone_id"]): float(row["confidence"])
                        for row in cur.fetchall()
                    }
                stage_e4_e7(conn, cycle, corroboration, get_settings())
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"model run failed for cycle {cycle}: {exc}") from exc

    def _assessment(zone_id: str) -> dict[str, Any] | None:
        with connect(args.db_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT a.zone_id, a.model_risk, a.model_band, a.operational_band
                    FROM assessments a
                    WHERE a.zone_id = %s AND a.cycle = %s
                    """,
                    (zone_id, cycle),
                )
                row = cur.fetchone()
                return dict(row) if row else None

    def _pick_target() -> dict[str, Any] | None:
        with connect(args.db_url) as conn:
            with conn.cursor() as cur:
                if args.escalate_zone:
                    cur.execute(
                        """
                        SELECT a.zone_id, a.model_risk, a.model_band, a.operational_band
                        FROM assessments a
                        WHERE a.zone_id = %s AND a.cycle = %s
                          AND NOT EXISTS (
                            SELECT 1
                            FROM situations s
                            WHERE s.zone_id = a.zone_id
                              AND s.hazard = 'conflict_pressure'
                              AND s.status = 'open'
                          )
                        """,
                        (args.escalate_zone, cycle),
                    )
                    row = cur.fetchone()
                else:
                    cur.execute(
                        """
                        SELECT a.zone_id, a.model_risk, a.model_band, a.operational_band
                        FROM assessments a
                        WHERE a.cycle = %s
                          AND a.model_band = 'elevated'
                          AND NOT EXISTS (
                            SELECT 1
                            FROM situations s
                            WHERE s.zone_id = a.zone_id
                              AND s.hazard = 'conflict_pressure'
                              AND s.status = 'open'
                          )
                        ORDER BY a.model_risk DESC
                        LIMIT 1
                        """,
                        (cycle,),
                    )
                    row = cur.fetchone()
                    if row is None:
                        cur.execute(
                            """
                            SELECT a.zone_id, a.model_risk, a.model_band,
                                   a.operational_band
                            FROM assessments a
                            WHERE a.cycle = %s
                              AND NOT EXISTS (
                                SELECT 1
                                FROM situations s
                                WHERE s.zone_id = a.zone_id
                                  AND s.hazard = 'conflict_pressure'
                                  AND s.status = 'open'
                              )
                            ORDER BY a.model_risk DESC
                            LIMIT 1
                            """,
                            (cycle,),
                        )
                        row = cur.fetchone()
                return dict(row) if row else None

    try:
        target = _pick_target()
        if target is None:
            logger.warning("natural escalation found no dormant target at cycle %s", cycle)
            return
        target_zone = str(target["zone_id"])
        logger.info(
            "natural escalation target: %s model_risk=%.3f model_band=%s "
            "operational_band=%s",
            target_zone,
            float(target["model_risk"]),
            target["model_band"],
            target["operational_band"],
        )
        if args.call_number:
            db.point_roster_at(args.call_number, target_zone)

        escalation_reports = (
            (
                "ngo_monitor",
                "migration_influx",
                "Three separate monitors report violent competition at {loc} "
                "water points; elders request immediate mediation.",
            ),
            (
                "chief",
                "pasture_dispute",
                "Community leaders near {loc} report armed groups blocking the main "
                "grazing corridor and households sheltering away from the route.",
            ),
            (
                "water_committee",
                "water_dispute",
                "Field teams near {loc} confirm repeated livestock losses and rising "
                "tension around the remaining pasture and water access.",
            ),
        )
        for offset, (role, category, template) in enumerate(escalation_reports):
            narrative = (
                f"DP-{run_tag}-{1000 + offset:04d}: "
                f"{template.format(loc=_place(target_zone))}"
            )
            report_id = db.insert_field_report(
                target_zone,
                role,
                category,
                3,
                narrative,
                report_time,
            )
            if report_id:
                counters.reports += 1
                logger.info(
                    "  report filed: %s [%s sev3] (%s; available=%s)",
                    category,
                    role,
                    target_zone,
                    report_time.date(),
                )
                _verify_report_id(client, target_zone, report_id, counters)
        if db.inject_news(
            target_zone,
            cycle,
            run_tag,
            1000,
            confidence=0.8,
            available_at=report_time,
        ):
            counters.news += 1
        logger.info("natural escalation: corroborating data fed; running model")
        _run_model()
    except Exception as exc:  # noqa: BLE001
        logger.warning("natural escalation failed — continuing without escalation: %s", exc)
        return

    feature = next(
        (
            feature
            for feature in client.get(f"{API}/map/situations").json().get("features", [])
            if feature.get("properties", {}).get("zone_id") == target_zone
        ),
        None,
    )
    properties = feature.get("properties", {}) if feature else {}
    situation_id = properties.get("situation_id")
    if situation_id:
        logger.info(
            "SITUATION OPENED naturally at %s — operational_band=%s, "
            "now rendered on the map",
            target_zone,
            properties.get("operational_band"),
        )
        alert_id = _draft_alert(client, properties, counters)
        if alert_id and args.dispatch:
            _approve_and_dispatch(
                client, alert_id, target_zone, args.call_number, counters
            )
        return

    latest = _assessment(target_zone)
    model_risk = latest.get("model_risk") if latest else "unknown"
    operational_band = latest.get("operational_band") if latest else "unknown"
    logger.warning(
        "natural escalation did not open a situation at %s — model_risk=%s "
        "operational_band=%s",
        target_zone,
        model_risk,
        operational_band,
    )


# ---------------------------------------------------------------------------
# One tick of the continuous feed: touches every data flow.
# ---------------------------------------------------------------------------
def _tick(client: httpx.Client, db: DBChannel, tick: int, run_tag: str,
          args: argparse.Namespace, counters: Counters,
          state: dict[str, Any]) -> None:
    zones = _situation_zones(client)
    if not zones:
        logger.warning("no open situations yet — is the seeded pipeline loaded? skipping tick")
        return
    cycle = _latest_cycle(zones)

    logger.info("── tick %03d ─────────────────────────────────────────────", tick)

    # 1) A fresh field report in a rotating situation-zone.
    report_zone = zones[tick % len(zones)]["zone_id"]
    narrative = _file_report(client, report_zone, run_tag, tick, counters)

    # 2) Verify the PREVIOUS tick's report so corroboration accrues over time.
    prev = state.get("last_report")
    if prev:
        _verify_report(client, prev[0], prev[1], counters)
    if narrative:
        state["last_report"] = (report_zone, narrative)

    # 3) A fresh news signal in another zone (direct DB, degrades gracefully).
    if not args.no_news and db.enabled:
        news_zone = zones[(tick + 1) % len(zones)]["zone_id"]
        if db.inject_news(news_zone, cycle, run_tag, tick):
            counters.news += 1

    # 4) Periodically draft an alert on the hottest zone, and dispatch it when asked.
    if (args.once and tick == 0) or (tick > 0 and tick % args.alert_every == 0):
        hottest = zones[0]
        alert_id = _draft_alert(client, hottest, counters)
        if alert_id and args.dispatch:
            _approve_and_dispatch(
                client, alert_id, hottest["zone_id"], args.call_number, counters
            )

    logger.info("   tally: %s", counters.line())


# ---------------------------------------------------------------------------
# Entry point.
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--fast", action="store_true", help="10x speed (rehearsal)")
    parser.add_argument("--once", action="store_true",
                        help="run a single full pass immediately, then exit")
    parser.add_argument("--loop", action="store_true",
                        help="keep feeding indefinitely (default if neither --once nor a "
                             "--ticks count is given)")
    parser.add_argument("--ticks", type=int, default=0,
                        help="run exactly N ticks then exit (0 = unlimited with --loop)")
    parser.add_argument("--interval", type=float, default=20.0,
                        help="seconds between ticks (default 20; --fast divides by 10)")
    parser.add_argument("--alert-every", type=int, default=4,
                        help="draft an alert every N ticks (default 4)")
    parser.add_argument("--dispatch", action="store_true",
                        help="also approve drafted alerts and push them to deliveries "
                             "(mock or Twilio, per the server's DISPATCH_MODE)")
    parser.add_argument("--call-number", metavar="E164", default=None,
                        help="phone number to dial: repoints the recipient roster at this "
                             "number and implies --dispatch (real call only if the server "
                             "runs DISPATCH_MODE=twilio)")
    parser.add_argument("--no-news", action="store_true",
                        help="skip news-signal injection (pure HTTP mode)")
    parser.add_argument("--escalate", action="store_true",
                        help="naturally open a new situation from corroborating data")
    parser.add_argument("--escalate-zone", metavar="ZONE_ID",
                        help="zone to escalate (default: highest-risk dormant zone)")
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL"),
                        help="Postgres URL for news/roster writes (default $DATABASE_URL)")
    parser.add_argument("--seed", type=int, default=None,
                        help="seed the RNG for reproducible content")
    args = parser.parse_args()

    if args.call_number:
        args.dispatch = True
    if args.seed is not None:
        random.seed(args.seed)

    interval = 0.0 if args.once else args.interval / (10 if args.fast else 1)
    run_tag = uuid.uuid4().hex[:6]
    counters = Counters()
    state: dict[str, Any] = {}

    db = DBChannel(args.db_url)

    with httpx.Client(timeout=60.0) as client:
        _require_seeded(client)

        if args.call_number:
            if not db.enabled:
                logger.warning(
                    "--call-number needs DB access to set the recipient roster; "
                    "without it the server's existing active recipients are dialed instead"
                )
            else:
                # Scope the demo recipient to the hottest situation zone.
                zones = _situation_zones(client)
                target_zone = zones[0]["zone_id"] if zones else None
                db.point_roster_at(args.call_number, target_zone)

        mode = (
            "dispatch+call"
            if args.call_number
            else ("dispatch" if args.dispatch else "draft-only")
        )
        logger.info(
            "demo pulse starting: run=%s mode=%s news=%s interval=%.1fs",
            run_tag, mode, "on" if (db.enabled and not args.no_news) else "off", interval,
        )

        tick = 0
        try:
            if args.escalate:
                _open_situation_naturally(client, db, args, run_tag, counters)
            if args.once and not args.escalate:
                _tick(client, db, tick, run_tag, args, counters, state)
            elif not args.once:
                while True:
                    _tick(client, db, tick, run_tag, args, counters, state)
                    tick += 1
                    if args.ticks and tick >= args.ticks:
                        break
                    time.sleep(max(interval, 1.0))
        except KeyboardInterrupt:
            logger.info("stopped by operator")

        logger.info("demo pulse done — final tally: %s", counters.line())


if __name__ == "__main__":
    main()
