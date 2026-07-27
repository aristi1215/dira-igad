# Improvements

Backlog of product and ML honesty gaps identified during review. These are intentional follow-ups, not bugs in the current demo path.

## 0. Finish Africa's Talking → Twilio voice migration

**Status.** Env is Twilio-first (`.env.example`); runtime still Mock / legacy AT adapter. **Update the whole application** (worker settings `dispatch_mode`, `dira_dispatch` Twilio adapter, API webhooks for Gather/status, remove or quarantine AT routes, README/AGENTS/DEVIATIONS). Do not leave half AT / half Twilio.

## 1. Time window on every alert card

**Problem.** The system surfaces risk bands and scores (`model_risk`, `model_band`, corroboration) but does not give operators a usable **forecast window** on each alert/situation card. Narrative copy elsewhere mentions “~3–4 weeks,” yet that horizon is not a first-class, visible field tied to each card.

**Why it matters.** Without an explicit window (e.g. “next 1–3 dekads” / “~30 days”), the alert is not operationally functional: recipients and approvers cannot plan anticipatory action against a vague “high risk.”

**Proposed improvement.**

- Show a clear time window on every alert card (and ideally on the situation dossier): start/end or “within N dekads.”
- Persist the horizon with the assessment/alert (schema already contemplates `horizon_days` in the long spec; wire it through API + UI).
- Align ML labels with that same horizon so the window is not only UI copy (see §3).

## 2. Frontend: ML model description (accuracy & training)

**Problem.** Operators see scores and SHAP-style factor lists but have no in-product explanation of **how the model was trained** or **how accurate it is**. That undermines trust and invites over-reading demo metrics.

**Proposed improvement.**

- Add a dedicated ML model description surface in the frontend (exact placement TBD — e.g. Analytics, Sources, a “Model card” drawer on the map/situation panel, or Settings).
- Content should include, at minimum:
  - **What it predicts** (risk/pressure score and band; not a calendar date of conflict).
  - **How it was trained** (feature set from `dira_features`, train/serve identity, temporal split, TransparentIndex vs LightGBM, seeded vs live data).
  - **Accuracy / honesty** — report metrics in context (Brier, MAE vs persistence / climatology / CAST), and state limitations (short seeded history, contemporaneous labels today, demo often runs TransparentIndex per D-009).
  - **What it does not claim** (exact conflict day, actor identity, guaranteed occurrence).

Placement and copy can be defined later; the requirement is that the description exists in the UI, not only in `artifacts/model_card.json` or docs.

## 3. ML foresight & evaluation (context for the above)

Current training in `dira_ml.train` labels “incidents in the **same** dekad” while also using `incident_count_dekad` as a feature. Demo inference often uses **TransparentIndex**, not the LightGBM artifact. Model-card scores can look near-perfect on seeded data without meaning real foresight.

Follow-ups that unlock honest accuracy and a real time window:

- Train/evaluate on **future** labels (conflict in t+1…t+H dekads matching the card horizon).
- Keep reporting lift over baselines; do not promote seeded Brier/MAE as field accuracy.
- Only switch the active inference model to LightGBM when Mandera (or live) history shows honest lift — consistent with README / D-009.

## 4. Demo pulse feeder (keep the room alive)

**Problem.** `make demo` leaves a static storefront. During a live walkthrough the map, situations, and dispatch screens barely move unless someone manually hits APIs or re-runs pipeline cycles.

**Goal.** A small long-running **demo pulse** process (separate from API/web/dispatch) that keeps injecting plausible activity into the **existing** backend so SSE and the UI update throughout the talk — no new product surface required.

**Feasible shape (implementation TBD by agent):**

- Runs only when explicitly started for demos; `DATA_MODE=seeded`; uses existing HTTP/DB entry points (`POST /field-reports`, verify/dismiss, alert approve path, mock dispatch/acks, optional pipeline `--cycle` ticks).
- Scripted Mandera-first scenario over ~10–20 minutes: staggered field reports → some verified → risk/corroboration movement → situations/alerts → approve → mock call → ack → map settles.
- Idempotent / restart-safe; never invents live network sources; never bypasses the human gate.
- Success = operators can leave API + web + dispatch + pulse running and the room visibly “breathes” for the demo.
- The amount of data should be huge, constant and functional so all the functionalities can be showed during the demo.


## 5. Frontend (clarity + craft)

The frontend has improved, but it still needs a lot of work — both visuals and functionality. The product still lacks many things operators need.

### 5.1 Understandability first (Stripe)

One of the most important things about this product is that it is **easily understandable**. We do not want complex words or acronyms just to sound fancy, or to display data in a complicated way just to look more professional. The most important thing is that the data is accurate and can be understood at first glance.

Take inspiration from **Stripe**: their data is extremely complex (credit cards, code integrations, some of the hardest topics), but their dashboard feels relaxed and natural — you barely need training because everything is so smooth. **That** is what we want for this website. Go to their dashboard and get **direct** inspiration. Be very direct.

Take the situations explanations as an example. When an operators looks at a situations immediately sees something like this: "Two-score combination
The band is never a black box — the exact rule is stored on every assessment

Model risk (pure)
0.67
Corroboration
0.72
v1_weighted_70_30_with_corroboration_bump: operational_score=0.7*model_risk(0.675)+0.3*corroboration(0.720)=0.688→high; corroboration_bump→very_high; corroboration=max(news 0.72, verified_field_reports 0.70)"

That's not understandable, we want to communicate ALWAYS through the visuals, the visuals are the best communication method for humans unlike machines, I need to see a graphic that is immediately understandable and then I can see text that actually matches what i'm looking at or explains it, but text is not a priority, visuals are.

Also things like: "news signals, field reports, frozen snapshot", all of these are concepts that we understand because we have worked on the app but someone who just sees it for the first time would feel scared and lost, we want to find the perfect middle in between accuracy and clarity. Also the zones dashboard is just a list that is again, too much text, too little visuals, too litle clarity.

One more thing that should be implemented its an explanation flow for a user that just cames to the website for the first time, it shows beautifully looking squares that drives them through the website explainin each thing, so even if someone does not anything about this project or climate hazards or IGAD, it understands what this does.


### 5.2 Visual craft (IBM, not “AI generic”)

We want something professional. We were taking inspiration from **IBM**, but it does not look like it yet. The current project looks OK — not really bad — but when you look at IBM it feels complete, relaxed, and organized. This project still looks like it was done by AI: generic fonts, generic layouts, generic cards, generic dots on the map. Information display should feel very professional.

### 5.3 Map markers (worst offender)

The dots on the map are one of the worst-looking things on the site right now. They look like an ugly square with an ugly dot in the middle — that does not tell me anything. It looks like a high-school project that does not take the information seriously. Take direct inspiration from projects like **Google Maps weather** or **IGAD hazard maps**.

### 5.4 Chatbot presentation

The way the chatbot is displayed is essentially horrible: not intuitive, does not look good, no animations — just a square that immediately appears in the middle of the screen. It does not show the value. Needs a professional open/close treatment and a layout that feels intentional.

### 5.5 Geological hazards (may need backend)

We should also include **geological hazards** on the map/UI. We are already collecting this information — we should be able to display it. May need a bit of extra backend wiring to expose what we already have.

## 6. Advisor LLM → real agent (Cursor / Claude-class)

**Today.** Ask Dira is a thin single-turn Q&A helper, not an agent. It calls OpenAI → Anthropic → canned (`dira_llm.factory`), with a small SQL snapshot (selected situation or top ~8 zones). Alert drafting is a separate endpoint; pipeline E3 extracts news signals. The chat cannot act inside the product.

| Capability | Current state |
|---|---|
| LLM completion | Yes (if API key set) |
| RAG / vector retrieval for chat | **No** — `pgvector` column exists; nothing real embeds or retrieves for the advisor |
| Tools / MCP / function calling | **No** — port is only `complete` / `complete_json` |
| In-app actions | **No** — cannot approve, verify reports, dispatch, query freely, or navigate UI |
| Internet for chat | **No browse** — live = provider API only; live connectors feed the pipeline, not the advisor |
| Multi-turn / streaming / memory | **No** — one question → one answer, sync JSON |

**Goal.** Something as capable as Cursor or Claude with integrations: grounded answers, tools that can operate the situation room, and a chat UX that shows value (pairs with §5.4).

**Proposed direction (implementation TBD by agent):**

- **RAG for real** — embed and retrieve over news docs, CEWARN-style context, zone dossiers; stop pretending the embedding column is enough.
- **Tool calling against our own API** — read situations/zones/sources; propose drafts; optional gated actions (verify field report, prepare alert). **Never** bypass the human gate on approve/dispatch.
- **Multi-turn + streaming** — conversation history, citations to what was retrieved, answers that update as tools return.
- **Optional MCP / integrations later** — only after first-party tools work; same safety red lines (do-no-harm copy, no actor naming, no auto-dispatch).

Success = an operator can ask “what’s happening in Mandera and what should we do?” and get grounded, visual+prose guidance — and, with explicit confirmation, help drive the workflow — not a one-shot paragraph over eight JSON rows.
