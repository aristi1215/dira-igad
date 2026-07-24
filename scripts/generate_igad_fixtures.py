# ruff: noqa: E501
"""Generate deterministic IGAD-wide seeded fixtures (see DEVIATIONS.md D-006/D-010).

Writes data/seeded/igad/*: clusters, zones (synthetic simplified boundaries),
exposure, dekadal climate, ACLED-like events, recipients, and news articles.
Everything derives from a per-zone severity profile with a fixed RNG seed so
re-running produces byte-identical output (demo insurance; no network).
"""

from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "seeded" / "igad"

DEKADS = [
    "2025-11-01", "2025-11-11", "2025-11-21",
    "2025-12-01", "2025-12-11", "2025-12-21",
    "2026-01-01", "2026-01-11", "2026-01-21",
    "2026-02-01", "2026-02-11", "2026-02-21",
    "2026-03-01", "2026-03-11", "2026-03-21",
]

CLUSTERS = [
    {"id": "lower_shabelle", "name": "Lower Shabelle Corridor",
     "description": "Riverine corridor southwest of Mogadishu; drought-displacement pressure over irrigated farmland."},
    {"id": "jubaland", "name": "Jubaland Coast",
     "description": "Southern Somalia coastal and inland rangelands along the Juba river."},
    {"id": "gambella", "name": "Gambella Lowlands",
     "description": "Western Ethiopia lowlands; seasonal flooding and cross-border movement from South Sudan."},
    {"id": "abyei", "name": "Abyei Transitional Belt",
     "description": "Contested Sudan/South Sudan transitional area with seasonal cattle migration."},
    {"id": "marsabit_moyale", "name": "Marsabit–Moyale Frontier",
     "description": "Northern Kenya / southern Ethiopia frontier rangelands."},
    {"id": "karamoja", "name": "Karamoja Cluster",
     "description": "Uganda/Kenya border cluster with recurrent cattle-raiding cycles."},
    {"id": "blue_nile", "name": "Blue Nile Escarpment",
     "description": "Sudan Blue Nile escarpment; conflict-displacement overlay on rainfed farming."},
    {"id": "afar", "name": "Afar Triangle",
     "description": "Ethiopia/Djibouti Afar lowlands; extreme heat stress corridor."},
]

# (zone_id, cluster, name, country, lon_min, lat_min, lon_max, lat_max, severity 0..1)
ZONES = [
    ("shabelle_corridor", "lower_shabelle", "Lower Shabelle Corridor", "SO", 44.0, 1.6, 44.6, 2.1, 0.95),
    ("shabelle_coast", "lower_shabelle", "Shabelle Coast", "SO", 44.4, 1.1, 45.0, 1.6, 0.62),
    ("jubaland_coast", "jubaland", "Jubaland Coast", "SO", 42.2, -0.5, 42.9, 0.2, 0.85),
    ("jubaland_inland", "jubaland", "Jubaland Inland", "SO", 41.8, 0.2, 42.6, 0.9, 0.58),
    ("gambella_lowlands", "gambella", "Gambella Lowlands", "ET", 34.2, 7.9, 34.9, 8.6, 0.80),
    ("gambella_east", "gambella", "Gambella East", "ET", 34.9, 7.9, 35.5, 8.5, 0.52),
    ("abyei_belt", "abyei", "Abyei Transitional Belt", "SS", 28.0, 9.3, 28.8, 9.9, 0.72),
    ("abyei_north", "abyei", "Abyei North", "SD", 28.0, 9.9, 28.8, 10.5, 0.55),
    ("marsabit_frontier", "marsabit_moyale", "Marsabit Frontier", "KE", 37.6, 2.2, 38.4, 3.0, 0.66),
    ("moyale_border", "marsabit_moyale", "Moyale Border", "ET", 38.4, 3.0, 39.2, 3.7, 0.58),
    ("karamoja_cluster", "karamoja", "Karamoja Cluster", "UG", 34.0, 2.2, 34.8, 3.0, 0.60),
    ("turkana_west", "karamoja", "Turkana West", "KE", 34.8, 2.8, 35.6, 3.6, 0.48),
    ("blue_nile_escarpment", "blue_nile", "Blue Nile Escarpment", "SD", 33.9, 11.3, 34.7, 12.0, 0.45),
    ("blue_nile_south", "blue_nile", "Blue Nile South", "SD", 33.9, 10.6, 34.7, 11.3, 0.38),
    ("afar_triangle", "afar", "Afar Triangle", "ET", 40.9, 11.4, 41.7, 12.1, 0.40),
    ("afar_coast", "afar", "Afar Coast", "DJ", 41.7, 11.4, 42.5, 12.1, 0.33),
]

EVENT_TYPES = [
    "Violence against civilians",
    "Battles",
    "Riots",
    "Strategic developments",
]

# Mandera cluster zones live in data/seeded/mandera/*, but the information-layer
# fixtures (IPC, displacement, prices, health, hazards, field reports) cover all
# 22 zones from one file set. (zone_id, name, country, severity 0..1)
MANDERA_ZONES = [
    ("mandera_ke_north", "Mandera Kenya North", "KE", 1.00),
    ("mandera_ke_south", "Mandera Kenya South", "KE", 0.82),
    ("mandera_et_west", "Mandera Ethiopia West", "ET", 0.90),
    ("mandera_et_east", "Mandera Ethiopia East", "ET", 0.70),
    ("mandera_so_north", "Mandera Somalia North", "SO", 0.88),
    ("mandera_so_south", "Mandera Somalia South", "SO", 0.75),
]

CURRENCY = {
    "KE": "KES", "ET": "ETB", "SO": "SOS", "SS": "SSP",
    "SD": "SDG", "UG": "UGX", "DJ": "DJF", "ER": "ERN",
}

# Rough staple price levels per currency so seeded values look plausible.
MAIZE_KG = {
    "KES": 62.0, "ETB": 48.0, "SOS": 14500.0, "SSP": 950.0,
    "SDG": 1400.0, "UGX": 1900.0, "DJF": 120.0, "ERN": 28.0,
}
GOAT_HEAD_FACTOR = 55.0  # goat price ≈ factor × healthy maize kg price

# Riverine/flood-prone, locust-corridor and heat-corridor zones for bulletins.
FLOOD_ZONES = {"shabelle_corridor", "shabelle_coast", "gambella_lowlands", "jubaland_coast"}
LOCUST_ZONES = {"marsabit_frontier", "moyale_border", "afar_triangle", "afar_coast", "karamoja_cluster"}
HEAT_ZONES = {"afar_triangle", "afar_coast", "mandera_so_north"}

FIELD_CATEGORIES = [
    "water_dispute", "pasture_dispute", "livestock_raid", "migration_influx",
    "market_disruption", "road_blockage", "armed_presence", "peace_meeting",
]
REPORTER_ROLES = ["field_monitor", "peace_committee", "drm_officer", "chief"]

NEWS = [
    {
        "id": "seed-news-2026-02-18-101",
        "title": "Water rationing extended along the Shabelle river corridor",
        "body": "Community elders in the Lower Shabelle corridor report boreholes running dry three weeks earlier than usual. Livestock keepers are moving herds toward riverine farmland, and water committees have introduced rationing schedules at the remaining wells.",
        "source": "Radio Shabelle (seeded corpus)",
        "published_at": "2026-02-18T06:00:00Z",
        "available_at": "2026-02-18T09:00:00Z",
        "related_zone_ids": ["shabelle_corridor", "shabelle_coast"],
    },
    {
        "id": "seed-news-2026-02-24-102",
        "title": "Pasture disputes reported near Jubaland coastal grazing routes",
        "body": "Herders arriving from drought-hit inland rangelands are congregating along coastal pasture in Jubaland. Local peace committees convened after disputes over grazing sequencing and access to two functioning water points.",
        "source": "Goobjoog News (seeded corpus)",
        "published_at": "2026-02-24T06:00:00Z",
        "available_at": "2026-02-24T09:00:00Z",
        "related_zone_ids": ["jubaland_coast"],
    },
    {
        "id": "seed-news-2026-03-02-103",
        "title": "Gambella lowlands see new arrivals as river levels fall",
        "body": "Seasonal migration into the Gambella lowlands started early this year. District officials report pressure on riverbank farmland and request support for water trucking to reduce competition at shallow wells.",
        "source": "Gambella Regional Radio (seeded corpus)",
        "published_at": "2026-03-02T06:00:00Z",
        "available_at": "2026-03-02T09:00:00Z",
        "related_zone_ids": ["gambella_lowlands"],
    },
    {
        "id": "seed-news-2026-03-05-104",
        "title": "Cattle movement through Abyei belt ahead of dry-season peak",
        "body": "Monitors describe larger-than-usual cattle movements crossing the Abyei transitional belt. Joint community meetings agreed on corridor timings, though water access at two points remains contested.",
        "source": "Radio Tamazuj (seeded corpus)",
        "published_at": "2026-03-05T06:00:00Z",
        "available_at": "2026-03-05T09:00:00Z",
        "related_zone_ids": ["abyei_belt", "abyei_north"],
    },
    {
        "id": "seed-news-2026-03-08-105",
        "title": "Marsabit frontier wells under strain as dry spell continues",
        "body": "Vegetation conditions along the Marsabit-Moyale frontier continue to decline. County officers note rising congestion at boreholes and have asked peace committees to pre-position mediation teams along the border grazing routes.",
        "source": "Kenya News Agency (seeded corpus)",
        "published_at": "2026-03-08T06:00:00Z",
        "available_at": "2026-03-08T09:00:00Z",
        "related_zone_ids": ["marsabit_frontier", "moyale_border"],
    },
]


def box(lon_min: float, lat_min: float, lon_max: float, lat_max: float) -> dict:
    return {
        "type": "MultiPolygon",
        "coordinates": [[[
            [lon_min, lat_min], [lon_max, lat_min], [lon_max, lat_max],
            [lon_min, lat_max], [lon_min, lat_min],
        ]]],
    }


def main() -> int:
    rng = random.Random(20260321)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "geojson").mkdir(exist_ok=True)
    (OUT / "acled").mkdir(exist_ok=True)
    (OUT / "climate").mkdir(exist_ok=True)
    (OUT / "exposure").mkdir(exist_ok=True)

    write("geojson/clusters.json", CLUSTERS)

    features = []
    for zid, cluster, name, country, lon0, lat0, lon1, lat1, _sev in ZONES:
        features.append({
            "type": "Feature",
            "properties": {"id": zid, "name": name, "country_iso2": country, "cluster_id": cluster},
            "geometry": box(lon0, lat0, lon1, lat1),
        })
    write("geojson/zones.geojson", {"type": "FeatureCollection", "features": features})

    exposure = {}
    for zid, _c, _n, _co, *_box, sev in ZONES:
        exposure[zid] = {
            "population": int(40000 + sev * 460000 + rng.randint(0, 20000)),
            "pastoralist_share": round(0.35 + sev * 0.45, 2),
            "water_points": int(8 + (1 - sev) * 30 + rng.randint(0, 6)),
            "markets": rng.randint(2, 8),
        }
    write("exposure/exposure.json", exposure)

    climate = []
    for zid, _c, _n, _co, *_box, sev in ZONES:
        base_rain = 42.0 - sev * 10.0
        base_ndvi = 0.46 - sev * 0.08
        for i, dk in enumerate(DEKADS):
            progress = i / (len(DEKADS) - 1)
            decline = progress * sev
            rain = max(0.0, base_rain * (1.0 - 1.05 * decline) + rng.uniform(-2.5, 2.5))
            ndvi = max(0.06, base_ndvi * (1.0 - 0.75 * decline) + rng.uniform(-0.015, 0.015))
            d = date.fromisoformat(dk)
            climate.append({
                "zone_id": zid,
                "dekad_start": dk,
                "rain_mm": round(rain, 1),
                "rain_available_at": iso(d, 5),
                "ndvi_mean": round(ndvi, 3),
                "ndvi_available_at": iso(d, 8),
            })
    write("climate/climate.json", climate)

    events = []
    counter = 0
    for _zid, _c, _n, _co, lon0, lat0, lon1, lat1, sev in ZONES:
        n_events = int(3 + sev * 22)
        start = date(2024, 1, 15)
        span = (date(2026, 3, 18) - start).days
        for _ in range(n_events):
            counter += 1
            offset = rng.betavariate(1.4, 1.0)  # skew recent
            d = start + timedelta(days=int(offset * span))
            events.append({
                "event_id": f"seed-acled-igad-{counter:04d}",
                "event_date": d.isoformat(),
                "lat": round(rng.uniform(lat0 + 0.02, lat1 - 0.02), 4),
                "lon": round(rng.uniform(lon0 + 0.02, lon1 - 0.02), 4),
                "event_type": rng.choice(EVENT_TYPES),
                "fatalities": max(0, int(rng.gauss(sev * 2.2, 1.4))),
                "actor1": "Pastoralist militia" if rng.random() < 0.5 else "Communal militia",
                "actor2": "Pastoralist herders" if rng.random() < 0.6 else "Farming community",
                "notes": "Seeded event derived from regional patterns for demo purposes.",
                "available_at": iso(d + timedelta(days=3), 0),
            })
    events.sort(key=lambda e: (e["event_date"], e["event_id"]))
    write("acled/events.json", events)

    recipients = []
    for idx, (zid, _c, name, _co, *_rest) in enumerate(ZONES, start=1):
        recipients.append({
            "name": f"{name} Peace Committee",
            "phone_e164": f"+2547009{idx:05d}",
            "zone_id": zid,
            "channel": "voice",
            "language": "sw",
            "active": True,
        })
        recipients.append({
            "name": f"{name} DRM Focal Point",
            "phone_e164": f"+2547008{idx:05d}",
            "zone_id": zid,
            "channel": "sms",
            "language": "sw",
            "active": True,
        })
    write("recipients.json", recipients)

    write("news_articles.json", NEWS)

    counts = generate_information_layer()
    print(
        f"[fixtures] zones={len(ZONES)} climate_rows={len(climate)} events={len(events)} "
        + " ".join(f"{k}={v}" for k, v in counts.items())
    )
    return 0


def _all_zones() -> list[tuple[str, str, str, float]]:
    """(zone_id, name, country, severity) for all 22 zones incl. Mandera."""
    igad = [(zid, name, co, sev) for zid, _c, name, co, *_b, sev in ZONES]
    return igad + MANDERA_ZONES


def generate_information_layer() -> dict[str, int]:
    """Emit the CEWARN information-layer fixtures (deterministic, own RNG)."""
    rng = random.Random(20260322)
    zones = _all_zones()
    demo_now = date(2026, 3, 20)

    # --- IPC food security: three consecutive analysis periods ---------------
    periods = [
        (date(2025, 7, 1), date(2025, 10, 31), date(2025, 7, 15)),
        (date(2025, 11, 1), date(2026, 2, 28), date(2025, 11, 20)),
        (date(2026, 3, 1), date(2026, 6, 30), date(2026, 3, 5)),  # current projection
    ]
    food_security = []
    for zid, _name, _co, sev in zones:
        for idx, (start, end, published) in enumerate(periods):
            worsening = idx * 0.5 * sev  # situation deteriorates into 2026
            phase = min(5, max(1, round(1.4 + sev * 2.2 + worsening)))
            pop_share = 0.04 + 0.11 * (phase - 1) + rng.uniform(0, 0.03)
            food_security.append({
                "zone_id": zid,
                "period_start": start.isoformat(),
                "period_end": end.isoformat(),
                "ipc_phase": phase,
                "pop_phase3_plus": int(pop_share * (40000 + sev * 460000)),
                "source": "ipc_fewsnet_seeded",
                "available_at": f"{published.isoformat()}T09:00:00Z",
            })

    # --- Displacement: monthly IOM-DTM-style snapshots (6 months) ------------
    displacement = []
    for zid, _name, _co, sev in zones:
        base_idps = int(sev * 26000)
        base_refugees = int(sev * 9000) if zid in {
            "gambella_lowlands", "gambella_east", "abyei_belt",
            "mandera_ke_north", "mandera_et_west",
        } else int(sev * 1500)
        for m in range(6):
            snap = date(2025, 10, 1) + timedelta(days=31 * m)
            snap = date(snap.year, snap.month, 1)
            growth = 1.0 + 0.12 * m * sev
            displacement.append({
                "zone_id": zid,
                "snapshot_date": snap.isoformat(),
                "idps": int(base_idps * growth + rng.randint(0, 400)),
                "refugees": int(base_refugees * (1.0 + 0.05 * m) + rng.randint(0, 150)),
                "returnees": rng.randint(0, int(200 + (1 - sev) * 900)),
                "source": "iom_dtm_seeded",
                "available_at": f"{(snap + timedelta(days=18)).isoformat()}T09:00:00Z",
            })

    # --- Market prices: maize, sorghum, goat — 12 months ---------------------
    market_prices = []
    months = [date(2025, m, 1) for m in range(4, 13)] + [date(2026, m, 1) for m in range(1, 4)]
    for zid, name, co, sev in zones:
        cur = CURRENCY[co]
        maize0 = MAIZE_KG[cur]
        market = f"{name.split(' ')[0]} Market"
        series: dict[str, list[float]] = {"maize": [], "sorghum": [], "goat": []}
        for i, _month in enumerate(months):
            drought_push = 1.0 + (i / len(months)) * 0.85 * sev  # staples climb
            distress_sales = 1.0 - (i / len(months)) * 0.45 * sev  # livestock collapses
            series["maize"].append(maize0 * drought_push * rng.uniform(0.97, 1.03))
            series["sorghum"].append(maize0 * 0.82 * drought_push * rng.uniform(0.96, 1.04))
            series["goat"].append(maize0 * GOAT_HEAD_FACTOR * distress_sales * rng.uniform(0.95, 1.05))
        for commodity, prices in series.items():
            unit = "head" if commodity == "goat" else "kg"
            for i, month in enumerate(months):
                window = prices[max(0, i - 3):i] or prices[:1]
                avg3 = sum(window) / len(window)
                market_prices.append({
                    "zone_id": zid,
                    "market_name": market,
                    "month": month.isoformat(),
                    "commodity": commodity,
                    "unit": unit,
                    "price": round(prices[i], 2),
                    "currency": cur,
                    "pct_vs_3m_avg": round((prices[i] / avg3 - 1.0) * 100, 1),
                    "source": "wfp_vam_seeded",
                    "available_at": f"{(month + timedelta(days=12)).isoformat()}T09:00:00Z",
                })

    # --- Health surveillance: weekly lines for cholera/measles ---------------
    health = []
    for zid, _name, _co, sev in zones:
        if sev < 0.55:
            continue
        weekly_base = sev * 22
        for w in range(8):
            week = demo_now - timedelta(days=7 * (8 - w))
            week = week - timedelta(days=week.weekday())  # Monday
            cases = max(0, int(weekly_base * (0.6 + 0.09 * w) + rng.randint(-3, 4)))
            status = "outbreak" if (sev >= 0.85 and w >= 5) else ("alert" if cases > 14 else "monitoring")
            health.append({
                "zone_id": zid,
                "week_start": week.isoformat(),
                "disease": "cholera",
                "cases": cases,
                "deaths": max(0, int(cases * 0.025 + (1 if rng.random() < 0.2 else 0))),
                "status": status,
                "source": "who_ewars_seeded",
                "available_at": f"{(week + timedelta(days=9)).isoformat()}T09:00:00Z",
            })
        if sev >= 0.8:
            week = demo_now - timedelta(days=21)
            week = week - timedelta(days=week.weekday())
            health.append({
                "zone_id": zid,
                "week_start": week.isoformat(),
                "disease": "measles",
                "cases": rng.randint(6, 18),
                "deaths": 0,
                "status": "alert",
                "source": "who_ewars_seeded",
                "available_at": f"{(week + timedelta(days=9)).isoformat()}T09:00:00Z",
            })

    # --- Hazard bulletins: flood / locust / heat / drought --------------------
    bulletins = []
    for zid, name, _co, sev in zones:
        if zid in FLOOD_ZONES:
            bulletins.append({
                "zone_id": zid,
                "hazard_type": "flood",
                "severity": "watch" if sev < 0.85 else "warning",
                "headline": f"GloFAS riverine flood {'warning' if sev >= 0.85 else 'watch'} — {name}",
                "detail": "Forecast river discharge above the 5-year return period during the "
                          "coming Gu/Genna rains; low-lying settlements and cropland exposed.",
                "valid_from": "2026-03-10",
                "valid_to": "2026-04-20",
                "source": "glofas_seeded",
                "available_at": "2026-03-10T06:00:00Z",
            })
        if zid in LOCUST_ZONES:
            bulletins.append({
                "zone_id": zid,
                "hazard_type": "locust",
                "severity": "advisory",
                "headline": f"FAO desert locust advisory — {name}",
                "detail": "Scattered immature swarms reported upwind; conditions favour breeding "
                          "where vegetation persists. Ground teams advised to maintain surveys.",
                "valid_from": "2026-02-25",
                "valid_to": "2026-04-30",
                "source": "fao_dlis_seeded",
                "available_at": "2026-02-25T06:00:00Z",
            })
        if zid in HEAT_ZONES:
            bulletins.append({
                "zone_id": zid,
                "hazard_type": "heat",
                "severity": "warning",
                "headline": f"Extreme heat warning — {name}",
                "detail": "Daytime temperatures 3–5°C above the March average for a third dekad; "
                          "elevated livestock and human heat stress.",
                "valid_from": "2026-03-01",
                "valid_to": "2026-03-31",
                "source": "icpac_seeded",
                "available_at": "2026-03-01T06:00:00Z",
            })
        if sev >= 0.8:
            bulletins.append({
                "zone_id": zid,
                "hazard_type": "drought",
                "severity": "warning",
                "headline": f"Severe drought conditions persist — {name}",
                "detail": "Accumulated rainfall deficit beyond the 90th percentile with vegetation "
                          "collapse; water point congestion and abnormal livestock movement expected.",
                "valid_from": "2026-02-01",
                "valid_to": "2026-05-31",
                "source": "icpac_seeded",
                "available_at": "2026-02-01T06:00:00Z",
            })

    # --- Field reports: CEWARN field-monitor primary channel ------------------
    field_reports = []
    counter = 0
    narratives = {
        "water_dispute": "Queueing at the remaining functional borehole escalated into a dispute "
                         "between arriving herders and resident users; committee mediation ongoing.",
        "pasture_dispute": "Disagreement over grazing sequencing on the remaining wet-season "
                           "reserve; elders requested a corridor timing meeting.",
        "livestock_raid": "Small-scale livestock theft reported overnight; animals tracked toward "
                          "the boundary. No injuries reported.",
        "migration_influx": "Larger-than-usual arrival of herds from neighbouring rangeland; "
                            "pressure rising on water points and pasture.",
        "market_disruption": "Weekly market attendance dropped sharply; traders citing insecurity "
                             "on the access road and abnormal cereal prices.",
        "road_blockage": "Main supply road impassable; transporters demanding escorts before "
                         "resuming deliveries.",
        "armed_presence": "Unidentified armed group sighted moving through the area at dusk; "
                          "no incident recorded.",
        "peace_meeting": "Inter-community peace meeting held; agreement on shared watering "
                         "schedule for the coming month.",
    }
    for zid, _name, _co, sev in zones:
        n = int(2 + sev * 6)
        for _k in range(n):
            counter += 1
            days_ago = int(rng.betavariate(1.1, 1.6) * 70)
            reported = datetime(2026, 3, 20, rng.randint(6, 18), rng.choice([0, 15, 30, 45])) - timedelta(days=days_ago)
            weights = [3 + 4 * sev, 2 + 3 * sev, 1 + 4 * sev, 2 + 3 * sev, 1 + sev, 0.6, 0.5 + sev, 1.5 - sev]
            category = rng.choices(FIELD_CATEGORIES, weights=weights, k=1)[0]
            severity = 1 if category == "peace_meeting" else min(3, max(1, round(0.8 + sev * 2 + rng.uniform(-0.4, 0.4))))
            verified = rng.random() < (0.55 if sev >= 0.8 else 0.35)
            report = {
                "id": f"seed-field-{counter:04d}",
                "zone_id": zid,
                "reporter_role": rng.choice(REPORTER_ROLES),
                "category": category,
                "severity": severity,
                "narrative": narratives[category],
                "reported_at": reported.strftime("%Y-%m-%dT%H:%M:00Z"),
                "status": "verified" if verified else "unverified",
                "verified_by": "CEWARN country coordinator" if verified else None,
                "verified_at": (reported + timedelta(hours=rng.randint(4, 48))).strftime("%Y-%m-%dT%H:%M:00Z") if verified else None,
                "available_at": reported.strftime("%Y-%m-%dT%H:%M:00Z"),
            }
            field_reports.append(report)
    field_reports.sort(key=lambda r: (r["reported_at"], r["id"]))

    write("food_security.json", food_security)
    write("displacement.json", displacement)
    write("market_prices.json", market_prices)
    write("health.json", health)
    write("hazard_bulletins.json", bulletins)
    write("field_reports.json", field_reports)
    return {
        "food_security": len(food_security),
        "displacement": len(displacement),
        "market_prices": len(market_prices),
        "health": len(health),
        "hazard_bulletins": len(bulletins),
        "field_reports": len(field_reports),
    }


def iso(d: date, lag_days: int) -> str:
    return datetime(d.year, d.month, d.day, 9, 0).strftime("%Y-%m-%dT%H:%M:%SZ").replace(
        f"{d.isoformat()}T", f"{(d + timedelta(days=lag_days)).isoformat()}T"
    )


def write(rel: str, obj: object) -> None:
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
