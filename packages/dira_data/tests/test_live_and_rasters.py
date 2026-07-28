from __future__ import annotations

from dira_data.live import (
    GdacsHazardAdapter,
    GdeltNewsAdapter,
    _gdelt_seendate_to_iso,
    normalize_hdx_app_identifier,
)
from dira_data.rasters import chirps_dekad_url, dekad_index


def test_normalize_hdx_encodes_plaintext(monkeypatch) -> None:
    monkeypatch.delenv("HDX_APP_ENCODED", raising=False)
    encoded = normalize_hdx_app_identifier("dira:user@example.com")
    assert encoded == "ZGlyYTp1c2VyQGV4YW1wbGUuY29t"


def test_normalize_hdx_prefers_encoded_env(monkeypatch) -> None:
    monkeypatch.setenv("HDX_APP_ENCODED", "ZGlyYTp1c2VyQGV4YW1wbGUuY29t")
    assert (
        normalize_hdx_app_identifier("dira:user@example.com")
        == "ZGlyYTp1c2VyQGV4YW1wbGUuY29t"
    )


def test_chirps_dekad_url_for_cycle_starts() -> None:
    from datetime import date

    assert dekad_index(date(2024, 3, 11)) == 2
    url = chirps_dekad_url(date(2024, 3, 11))
    assert url.endswith("chirps-v2.0.2024.03.2.tif.gz")


def test_gdelt_seendate_to_iso() -> None:
    assert _gdelt_seendate_to_iso("20260722T100000Z") == "2026-07-22T10:00:00Z"


def test_gdelt_maps_artlist_payload(monkeypatch) -> None:
    class _Resp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "articles": [
                    {
                        "url": "https://example.com/a",
                        "title": "Drought deepens in Kenya",
                        "seendate": "20260722T100000Z",
                        "domain": "example.com",
                        "sourcecountry": "Kenya",
                    },
                    {"url": "", "title": "skip me"},
                ]
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def get(self, *args, **kwargs):
            return _Resp()

    monkeypatch.setattr("httpx.Client", _Client)
    articles = GdeltNewsAdapter().fetch_articles()
    assert len(articles) == 1
    assert articles[0]["id"].startswith("gdelt-")
    assert "Drought deepens" in articles[0]["title"]
    assert articles[0]["source"] == "GDELT/example.com"
    assert articles[0]["published_at"] == "2026-07-22T10:00:00Z"


def test_gdacs_maps_igad_flood_to_zone_bulletins(monkeypatch) -> None:
    class _Resp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "type": "FeatureCollection",
                "features": [
                    {
                        "properties": {
                            "eventtype": "FL",
                            "eventid": 1,
                            "episodeid": 1,
                            "name": "Flood in Somalia",
                            "description": "Flood in Somalia",
                            "htmldescription": "Orange Flood in Somalia",
                            "alertlevel": "Orange",
                            "iso3": "SOM",
                            "fromdate": "2026-07-01T00:00:00",
                            "todate": "2026-07-15T00:00:00",
                            "source": "GLOFAS",
                            "url": {"report": "https://www.gdacs.org/report.aspx?eventid=1"},
                            "affectedcountries": [{"iso3": "SOM"}],
                        }
                    },
                    {
                        "properties": {
                            "eventtype": "FL",
                            "eventid": 2,
                            "episodeid": 1,
                            "name": "Flood in Italy",
                            "alertlevel": "Green",
                            "iso3": "ITA",
                            "fromdate": "2026-07-01T00:00:00",
                            "todate": "2026-07-02T00:00:00",
                            "affectedcountries": [{"iso3": "ITA"}],
                        }
                    },
                ],
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            return None

        def get(self, *args, **kwargs):
            return _Resp()

    monkeypatch.setattr("httpx.Client", _Client)
    adapter = GdacsHazardAdapter()
    events = adapter.fetch_events()
    assert len(events) == 1
    assert events[0]["hazard_type"] == "flood"
    assert events[0]["severity"] == "watch"
    assert events[0]["iso3"] == "SOM"

    rows = adapter.bulletin_rows(
        events, {"SO": ["shabelle_corridor", "jubaland_coast"]}
    )
    assert len(rows) == 2
    assert {r["zone_id"] for r in rows} == {"shabelle_corridor", "jubaland_coast"}
    assert all(r["source"] == "gdacs_live" for r in rows)
    assert all("external_key" in r for r in rows)
