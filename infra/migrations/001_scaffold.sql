# Dira schema v2 — structural invariants only as placeholders for the
# implementation agent. Replace/expand this file with the full authoritative
# schema from the consolidated specification (bitemporal climate, human gate
# CHECK on alerts, delivery queue + LISTEN/NOTIFY, v_map_situations view).
#
# Required extensions: postgis, vector, pgcrypto

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pgvector may need a custom image; create when available:
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Minimal bootstrap so local compose starts cleanly.
-- Full tables (clusters, zones, situations, alerts, deliveries, …)
-- are to be applied by the implementation agent from the spec Part 5.

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_meta (key, value)
VALUES ('schema_status', 'scaffold_pending_full_v2')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
