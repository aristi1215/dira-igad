Seeded Mandera fixtures live here for deterministic local demos.

- `geojson/cluster.json` and `geojson/zones.geojson` define the simplified
  Mandera tri-border cluster and shared-border zones.
- `exposure/exposure.json` contains static zonal exposure.
- `acled/events.json` contains synthetic ACLED-style observations, including
  deliberate out-of-zone events.
- `climate/climate.json` contains synthetic pre-aggregated dekadal rainfall and
  NDVI with realistic publication timestamps.
- `recipients.json` contains test voice recipients for Kenyan demo zones.

Run `uv run python -m scripts.bootstrap` or `make seed` to load these fixtures.
