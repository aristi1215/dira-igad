# Architecture Decision Records (ADR index)

Summaries of decisions from Dira consolidated spec v2. Full rationale lives in the authoritative document.

| # | Decision |
|---|----------|
| 1 | Modular monolith, not microservices |
| 2 | Hexagonal ports/adapters (seeded + fallbacks) |
| 3 | Monorepo so `dira_features` is shared (no train/serve skew) |
| 4 | Postgres as queue (`FOR UPDATE SKIP LOCKED`) |
| 5 | Postgres as bus (`LISTEN` / `NOTIFY`) |
| 6 | SSE, not WebSocket |
| 7 | TanStack Query + minimal Zustand |
| 8 | Zone GeoJSON + pre-rendered raster PNG tiles |
| 9 | Bitemporal `available_at` + first-write-wins upsert |
| 10 | Human gate as DB `CHECK` |
| 11 | `idempotency_key` + `provider_message_id` UNIQUE (honest scope) |
| 12 | pgvector in the same Postgres |
| 13 | Dekadal temporal grain |
| 14 | 7-stage pipeline; atomic storefront; no network in open Tx |
| 15 | Dispatch: two short Tx + `claimed_at` |
| 16 | Zombies → `needs_review`, not auto-retry |
| 17 | Local BGE-M3 embeddings, 1024 dims |
| 18 | Pre-generated TTS + `<Play>`; human-recorded fallback |
| 19 | Baselines: persistence + CAST at CAST grain + climatology |
| 20 | Do-not-harm alert content |
| 21 | Timestamps UTC; UI converts to EAT |

Implementation agent: expand individual ADR files under this folder only when a decision changes.
