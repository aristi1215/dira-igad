from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

PROFILE_KEYS = {
    "zone",
    "exposure",
    "climate",
    "incidents_monthly",
    "recent_events",
    "food_security",
    "displacement",
    "market_prices",
    "health",
    "hazard_bulletins",
    "field_reports",
    "news_signals",
    "situation",
    "recipients",
}


@pytest.fixture()
def client(database_url: str) -> TestClient:
    from dira_api import main as api_main

    return TestClient(api_main.app)


@pytest.fixture()
def cleanup_reports(db_conn) -> Iterator[list[str]]:
    created: list[str] = []
    yield created
    if created:
        with db_conn.cursor() as cur:
            cur.execute("DELETE FROM field_reports WHERE id = ANY(%s::uuid[])", (created,))
        db_conn.commit()


def test_zones_lists_every_zone_with_context(client: TestClient) -> None:
    response = client.get("/zones")
    assert response.status_code == 200
    zones = response.json()
    assert len(zones) == 22
    sample = zones[0]
    for key in ("zone_id", "zone_name", "cluster_name", "country_iso2", "ipc_phase",
                "idps", "operational_band", "model_risk", "situation_id"):
        assert key in sample


def test_zone_profile_is_the_full_dossier(client: TestClient) -> None:
    response = client.get("/zones/mandera_ke_north/profile")
    assert response.status_code == 200
    profile = response.json()
    assert set(profile) == PROFILE_KEYS
    assert profile["zone"]["id"] == "mandera_ke_north"
    assert profile["food_security"], "seeded IPC series must be present"
    assert profile["market_prices"], "seeded market prices must be present"


def test_regional_indicators_is_geojson_for_all_zones(client: TestClient) -> None:
    response = client.get("/indicators/regional")
    assert response.status_code == 200
    collection = response.json()
    assert collection["type"] == "FeatureCollection"
    assert len(collection["features"]) == 22
    props = collection["features"][0]["properties"]
    for key in ("zone_id", "ipc_phase", "idps", "incidents_180d", "operational_band"):
        assert key in props


def test_zones_and_regional_use_latest_assessment_without_open_situation(
    client: TestClient,
) -> None:
    """Quiet zones still get a map band from assessments; situation_id stays null."""
    from dira_api.settings import get_settings
    from dira_data.db import connect

    get_settings.cache_clear()
    url = get_settings().database_url
    zone_id = "afar_coast"
    cycle = "2030-01-01"
    with connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM situations WHERE zone_id = %s AND status = 'open'",
                (zone_id,),
            )
            cur.execute(
                "DELETE FROM assessments WHERE zone_id = %s AND cycle = %s",
                (zone_id, cycle),
            )
            cur.execute(
                """
                INSERT INTO assessments (
                  zone_id, cycle, prob_conflict, expected_incidents,
                  model_risk, model_band, corroboration, operational_band,
                  combination_rule, explanation, shap, exposure_snapshot
                ) VALUES (
                  %s, %s, 0.05, 0.1,
                  0.05, 'low', 0.0, 'low',
                  'test_rule', 'integration quiet zone', '{}'::jsonb, '{}'::jsonb
                )
                """,
                (zone_id, cycle),
            )
        conn.commit()

    try:
        zones = client.get("/zones").json()
        row = next(z for z in zones if z["zone_id"] == zone_id)
        assert row["operational_band"] == "low"
        assert row["model_risk"] == pytest.approx(0.05)
        assert row["situation_id"] is None

        features = client.get("/indicators/regional").json()["features"]
        props = next(
            f["properties"] for f in features if f["properties"]["zone_id"] == zone_id
        )
        assert props["operational_band"] == "low"
        assert props["situation_id"] is None

        overview = client.get("/analytics/overview").json()
        band_rows = {r["band"]: int(r["zones"]) for r in overview["band_distribution"]}
        assert sum(band_rows.values()) == 22
        assert band_rows.get("low", 0) >= 1
    finally:
        with connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM assessments WHERE zone_id = %s AND cycle = %s",
                    (zone_id, cycle),
                )
            conn.commit()


def test_hazards_is_geojson_with_current_bulletins(client: TestClient) -> None:
    response = client.get("/hazards")
    assert response.status_code == 200
    collection = response.json()
    assert collection["type"] == "FeatureCollection"
    assert len(collection["features"]) >= 3
    feature = collection["features"][0]
    assert feature["geometry"]["type"] == "Point"
    assert len(feature["geometry"]["coordinates"]) == 2
    assert {
        "id",
        "zone_id",
        "zone_name",
        "country_iso2",
        "hazard_type",
        "severity",
        "headline",
        "detail",
        "valid_from",
        "valid_to",
        "source",
    } <= feature["properties"].keys()


def test_sources_catalog_reports_mode_and_freshness(client: TestClient) -> None:
    response = client.get("/sources")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data_mode"] in {"seeded", "live"}
    assert payload["bitemporal_note"]
    keys = {source["key"] for source in payload["sources"]}
    assert {"acled", "ipc", "dtm", "wfp_prices", "field_reports"} <= keys


def test_analytics_overview_aggregates(client: TestClient) -> None:
    response = client.get("/analytics/overview")
    assert response.status_code == 200
    payload = response.json()
    for key in ("band_distribution", "incidents_monthly", "climate_by_cluster",
                "food_security_by_country", "displacement_by_country",
                "field_report_stats", "delivery_stats"):
        assert key in payload


def test_field_report_verification_gate(
    client: TestClient, cleanup_reports: list[str]
) -> None:
    created = client.post(
        "/field-reports",
        json={
            "zone_id": "mandera_ke_north",
            "reporter_role": "field_monitor",
            "category": "water_dispute",
            "severity": 2,
            "narrative": "integration: queue tension at borehole 4",
        },
    )
    assert created.status_code == 201
    report = created.json()
    cleanup_reports.append(report["id"])
    # Red line: reports are born unverified, whatever the client sends.
    assert report["status"] == "unverified"

    verified = client.post(
        f"/field-reports/{report['id']}/verify",
        json={"verified_by": "integration-officer"},
    )
    assert verified.status_code == 200
    assert verified.json()["status"] == "verified"
    assert verified.json()["verified_by"] == "integration-officer"

    # A settled report cannot be re-gated.
    again = client.post(
        f"/field-reports/{report['id']}/verify",
        json={"verified_by": "someone-else"},
    )
    assert again.status_code == 409
    dismissed = client.post(
        f"/field-reports/{report['id']}/dismiss",
        json={"verified_by": "someone-else"},
    )
    assert dismissed.status_code == 409
