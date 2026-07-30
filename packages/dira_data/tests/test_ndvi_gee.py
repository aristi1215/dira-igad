from __future__ import annotations

from dira_data.ndvi_gee import CombinedClimateAdapter, FallbackRainAdapter, GeeChirpsAdapter, GeeNdviAdapter

# Minimal smoke: CombinedClimateAdapter merges rain/ndvi dicts without network.


class _Stub:
    def __init__(self, payload):
        self.payload = payload

    def fetch_dekadal(self, zone_ids, dekad_start):
        return self.payload


def test_combined_climate_merges_rain_and_ndvi() -> None:
    from datetime import date

    rain = _Stub(
        {
            "z1": {
                "rain_mm": 12.0,
                "rain_available_at": "2024-01-06T00:00:00Z",
                "ndvi_mean": None,
                "ndvi_available_at": None,
            }
        }
    )
    ndvi = _Stub(
        {
            "z1": {
                "rain_mm": None,
                "rain_available_at": None,
                "ndvi_mean": 0.42,
                "ndvi_available_at": "2024-01-09T00:00:00Z",
            }
        }
    )
    combined = CombinedClimateAdapter(rain, ndvi)
    out = combined.fetch_dekadal(["z1"], date(2024, 1, 1))
    assert out["z1"]["rain_mm"] == 12.0
    assert out["z1"]["ndvi_mean"] == 0.42


def test_fallback_rain_uses_secondary_when_primary_empty() -> None:
    from datetime import date

    primary = _Stub({})
    secondary = _Stub(
        {
            "z1": {
                "rain_mm": 3.5,
                "rain_available_at": "2016-01-06T00:00:00Z",
                "ndvi_mean": None,
                "ndvi_available_at": None,
            }
        }
    )
    out = FallbackRainAdapter(primary, secondary).fetch_dekadal(["z1"], date(2016, 1, 1))
    assert out["z1"]["rain_mm"] == 3.5
    assert GeeChirpsAdapter is not None
    assert GeeNdviAdapter is not None
