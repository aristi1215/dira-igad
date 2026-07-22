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
    print(f"[fixtures] zones={len(ZONES)} climate_rows={len(climate)} events={len(events)}")
    return 0


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
