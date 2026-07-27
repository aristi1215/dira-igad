---
name: testing-dira-situation-room
description: Run and end-to-end test the Dira IGAD situation room (map, alerts, dispatch, economy, advisor) locally in seeded mode. Use when verifying Dira UI, pipeline, or dispatch changes.
---

# Testing the Dira IGAD situation room

## Start the stack (seeded mode)

All commands from the repo root; `uv` lives at `$HOME/.local/bin`.

1. `uv sync --all-packages` (plain `uv sync` misses workspace members — common gotcha).
2. Postgres 16 + PostGIS + pgvector must be running locally. Docker Compose may fail on some VMs (overlay whiteout errors — see DEVIATIONS D-008); local apt packages are a reliable fallback. `make up-db` falls back to `DATABASE_URL`.
3. Copy `.env.example` to `.env`; keep `DATA_MODE=seeded`. Quote passwords containing `$`.
4. `make seed && make demo` — seeds Mandera + IGAD fixtures (22 zones) and runs the E1–E7 pipeline. Expect bootstrap counts like `clusters=9 zones=22`.
5. API: `uv run uvicorn dira_api.main:app --port 8000`
6. Web: `npm --prefix apps/web run dev -- --host 0.0.0.0` (port 5173 — kill stale Vite processes if it lands on 5174).
7. Dispatch worker: `uv run python -m dira_worker.dispatch` — required for the golden path; watch its logs, a startup crash means deliveries stay `queued` forever.

## Golden-path UI test (multi-screen light-Carbon layout, D-017+)

The UI is a routed multi-screen app: Map / Situations / Zones / Dispatch / Analytics / Model / Sources, with an "Ask Dira" drawer and a "Tour" onboarding overlay in the header. First visit shows the onboarding tour (persisted in localStorage `dira-onboarding-done`; "Tour" reopens it).

1. http://localhost:5173 — dismiss/complete the tour; expect light CARTO map, 22-zone choropleth + situation markers, header cycle chip, SEEDED/LIVE mode chip, green "Live" SSE dot.
2. Click a marker or watchlist row — zone card shows band, model risk, **forecast window** ("Next ~30 days (…)"), IDPs, hazards; buttons to dossier/situation.
3. Situation detail — stat row includes Forecast window; risk trajectory chart, two-score combination rule, SHAP drivers, frozen snapshot, verified field reports.
4. "Prepare alert" → Dispatch screen: pending alert with Swahili draft + forecast window line; NO deliveries yet (human gate).
5. Enter an approver name and "Approve" — deliveries appear and turn `delivered / acknowledged` within ~10–30 s WITHOUT reload. If stuck `queued`, check the dispatch worker logs.
6. Model screen (/model): active model (LightGBM or TransparentIndex), Brier/MAE vs persistence/climatology/CAST baselines, multiple split runs, best/worst zones, limitations.
7. Ask Dira drawer: multi-turn chat; answers grounded in the selected zone with citations (news/hazard/field_report) and tools-used line.
8. Demo pulse: `make pulse` (or `uv run python -m scripts.demo_pulse --fast`) with API up — field reports/verifications/alert drafts appear live; it refuses to run unless DATA_MODE=seeded and never approves.

## Pitfalls / things that might be broken

- The SSE indicator may transiently flip to "Polling backup every 3s"; polling covers it and SSE usually reconnects — only treat as a failure if updates require manual refresh.
- psycopg3 APIs differ from psycopg2 (`conn.notifies()` is a generator method, Alembic needs the `postgresql+psycopg` URL via the project migration path); errors like `'function' object has no attribute ...` in workers usually mean psycopg2-style usage.
- Live ACLED read access may be denied at the account level even with valid OAuth credentials (DEVIATIONS D-013); seeded mode is the reliable default.
- The World Bank API can return HTML/5xx; the economy endpoint falls back to seeded data automatically.
- Twilio live mode (`DISPATCH_MODE=twilio`) requires a Twilio-owned/verified `TWILIO_FROM_NUMBER` **and** a public `PUBLIC_BASE_URL` (ngrok) for `<Play>` audio + `/webhooks/twilio/*` callbacks; without them keep `DISPATCH_MODE=mock`. Webhook payloads are form-encoded (`CallSid`, `Digits`, `CallStatus`); tests may post JSON.

## Devin Secrets Needed

- `OPENAI_API_KEY` (optional — advisor/alert drafting fall back to canned adapter without it)
- `ACLED_EMAIL` / `ACLED_PASSWORD` (optional — only for live ACLED mode)
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (or API key SID/secret) + `TWILIO_FROM_NUMBER` (optional — only for `DISPATCH_MODE=twilio`; MockDispatcher is the default and needs no credentials).
- `TTS_API_KEY` / `TTS_VOICE_ID` (optional — ElevenLabs live TTS for Twilio `<Play>` audio).
