from __future__ import annotations

from dira_data.climate import CLIMATE_FIRST_WRITE_WINS_SQL


def test_climate_upsert_is_first_write_wins_per_group() -> None:
    sql = " ".join(CLIMATE_FIRST_WRITE_WINS_SQL.split())

    assert "ON CONFLICT (zone_id, dekad_start) DO UPDATE" in sql
    assert "WHEN zone_climate_dekadal.rain_available_at IS NULL THEN EXCLUDED.rain_mm" in sql
    assert "rain_available_at = COALESCE(" in sql
    assert "zone_climate_dekadal.rain_available_at, EXCLUDED.rain_available_at" in sql
    assert "WHEN zone_climate_dekadal.ndvi_available_at IS NULL THEN EXCLUDED.ndvi_mean" in sql
    assert "ndvi_available_at = COALESCE(" in sql
    assert "zone_climate_dekadal.ndvi_available_at, EXCLUDED.ndvi_available_at" in sql
