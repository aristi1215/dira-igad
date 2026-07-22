# Dira — Project Report

IGAD Husika Hackathon 2026 · "Smarter Early Warning, Stronger Communities"

Causal situation room for the Horn of Africa: see the environmental danger emerge, watch it become conflict, and close it with a call that saves someone.

Working name: Dira (in Swahili, "compass" — orientation and direction; fits with an early warning system + advisor). The three modules keep the names you were already using: Tabiri (impact cards), Amani (conflict prediction), Onya (last-mile alerts). The name is yours to finalize.

## PART 0 — THE BRIEF (in simple words)

### What it is

Dira is a live map of the Horn of Africa that shows, in one place, two things that are really one chain: environmental hazards (where it hasn't rained, where vegetation is dying, where there is drought or extreme heat) and the conflict those hazards are about to unleash.

The map doesn't just paint zones in colors. On top of each critical zone it places a card that says exactly who is at risk: "here live 4,000 people, there is 1 clinic and 2 schools, and 3 water wells under dispute." And when a zone crosses the danger threshold, the map closes the loop: Onya calls by phone, with voice and in the local language, to peace committees and affected people, with clear instructions on what to do.

An artificial intelligence does the heavy lifting throughout the journey: it predicts where and when conflict will erupt, reads local news to catch early signals, drafts and translates alerts, and advises the operator from a panel next to the map. The only thing a human decides is pressing the final "send" button — because a false conflict alarm can escalate violence, not just annoy.

### The one-line pitch

Dira turns the forecasts that ICPAC already produces into actionable phone calls that reach those who need them, and anticipates climate conflict before it happens — always showing why.

### The moment that wins the 5-minute video

The operator sees a Mandera zone turn red. The AI advisor tells him: "High risk in Mandera West: rainfall fell 80% below normal, vegetation collapsed three weeks ago, and there are two reports of water tension. I predict conflict in 3-4 weeks. I've prepared the alert for the three peace committees." The operator reviews it and approves. A phone rings — a voice in Swahili gives instructions. The receiver presses 1 to confirm. On the map, the zone shifts from yellow "sent" to green "confirmed" in seconds.

That's not a dashboard. It's the alert→action cycle closing on screen.

## PART 1 — WHY THIS WINS

### The real gap (it's not the forecast)

Regional research is clear: ICPAC already produces world-class forecasts and open data. The bottleneck is not science — it's the last mile (alerts don't arrive, aren't understood, aren't trusted) and anticipatory action (the chain warning → pre-agreed action → pre-positioned funding breaks down). In March 2026, Kenya's flooding killed people after a correct warning was issued.

And there's a second gap almost no one will see: CEWARN's climate conflict product (the Climate-Induced Conflict Monthly Alert) is today a hand-made PDF, with a month's delay. Dira automates and improves it.

### The conceptual differentiator: the causal chain

All other teams will do isolated floods. Dira shows cause and effect, which is exactly what CEWARN's own model describes:

Uneven rainfall → vegetation stress with ~1 month lag → resource pressure → conflict risk

In the Horn of Africa this is not theory: drought moves livestock, livestock crosses borders, conflict follows. Showing that chain on one map — "here it didn't rain, here the grass died, here we predict conflict" — is a reflection that demonstrates we understand what's happening, not just that we paint data.

### How it maps to the rubric

| Criterion | Weight | How we attack it |
|---|---|---|
| Technical depth and engineering | 30% | Real pipeline that ingests real data from ICPAC/ACLED; model trained and validated against ACLED baseline (CAST); resilient dispatch system (idempotent, with human approval) |
| AI innovation and creativity | 30% | AI in four places with strong weight: explainable conflict prediction, unstructured news reading, voice generation/translation, agentic advisor |
| Problem value and impact | 25% | Anchored in documented failures (March 2026); named beneficiaries (Mandera peace committees); addresses connectivity, illiteracy, and language realities |
| Presentation and documentation | 15% | Clean repo, video with the live ack moment, disciplined 250-word briefs |

60% is technical. That's your profile. And the AI must do something that carries weight — not a chatbot bolted on top. Dira delivers.

### Why Mandera

It's the protagonist cluster because it's tri-border (Kenya-Ethiopia-Somalia: real geopolitical drama), the zero-rain drought is visually stark, and the rainfall→grass→livestock conflict link is the cleanest causal chain to tell in 5 minutes. The CEWARN PDF in your project already catalogs it as "very high risk" zone due to zero precipitation and livestock migration toward Mandera West and Dolo Bay.

## PART 2 — WHAT IT DOES (functional specification)

### 2.1 The live map

Two zoom levels, one experience:

- **Regional view (all the Horn):** shows environmental layers at a glance. Impresses with the scale and scope of the problem. The operator sees where the hot spots are across the entire region.
- **Zoom to protagonist cluster (Mandera):** here lives the complete cycle — the impact cards, conflict prediction, and Onya dispatch.

### 2.2 Environmental layers

Four layers that feed or surround the conflict model, plus ready-made flooding:

1. Rainfall — where it rained and where it didn't (deficit vs. normal).
2. Drought — accumulated rainfall deficit.
3. Vegetation health — where grass/crops are dying (the lag link).
4. Extreme heat — thermal stress.
5. Flooding (ready-made consumed) — we take flooding alerts that global systems already produce and show them; we don't model them ourselves.

Layers 1–4 are "free" to show because the conflict model already calculates them as input. That's the elegance: the environmental layer is the visible input side of the model.

### 2.3 Impact cards (Tabiri)

The Tabiri component you loved, generalized: take any critical hazard zone and cross it with "where people live + where clinics, schools, and wells are" to produce a card:

**Mandera West — Conflict Risk HIGH** · 4,000 people · 1 clinic · 2 schools · 3 wells under tension · Forecast: probable conflict in 3–4 weeks · [See why] [Prepare alert]

Key scope insight: the card is built once and works over any hazard (flooding, drought, conflict). What was expensive about Tabiri was never the card — it was computing where flooding starts from scratch. We don't do that: we consume ready-made flooding and just put the card on top. You get Tabiri's visual impact across the whole map without paying the cost of modeling water.

Only critical zones generate cards with actions. The rest are background color layers. Less noise, more signal.

### 2.4 Conflict prediction (Amani)

The heart. For each zone, the AI produces three outputs at a 3–4 week horizon (the lag CEWARN's own model implies):

1. **Conflict probability** — how likely is an event?
2. **Expected number of incidents** — how many?
3. **Risk score** — red / orange / yellow, for the map.

And — this is critical — it explains each forecast: "high risk because rainfall dropped 80%, vegetation fell 3 weeks ago, incidents rose 40% in the last month, and there are 2 unconfirmed news signals." It's powerful *and* transparent AI. You give the jury both things: real predictive capacity and reasons to trust.

### 2.5 News signals (unstructured data)

The AI reads recent news from the cluster zones (in any language, working internally in English) and extracts signals: "water tension reported in X", "livestock movement toward Y". These appear as 'unconfirmed signal' markers that raise the zone's risk score but never trigger an alert alone — a human validates.

This is a safety red line: a false conflict alert can escalate violence. The AI marks and summarizes; the human confirms.

For the demo, news comes seeded with real recent articles from those zones — a live scraper can go down on evaluation day; a real curated corpus looks equally impressive and never fails.

(Correction. It will only read from authorized sources that a human enters; even then it will ask for verification.)

### 2.6 Onya — closing the loop (the last mile)

When a critical zone crosses the threshold and a human approves, Onya dispatches:

- **Hero channel:** automatic voice call. It's the most impressive, the least done by other teams, and the only thing that reaches those who can't read.
- **Backups:** SMS, and WhatsApp shown as capability.
- **Language:** we implement end-to-end the one spoken in Kenya (Swahili); the rest is changing a parameter.
- **Recipients:** local peace committees and disaster management officials, exactly as CEWARN recommends.

The acknowledgment moment: during the call, the receiver presses 1 to confirm "received and will act". That acknowledgment returns to the map in seconds: the zone shifts from yellow "sent" to green "confirmed". That live color change, in the video, is what makes the jury feel the cycle closed.

### 2.7 The AI advisor

A lateral panel inside the map that sees what the operator sees. It can do everything: read all layers and signals, prioritize zones ("the most urgent now is X"), draft the brief in exact CEWARN format, and prepare sending an alert with message already drafted and translated. It operates on our own sources (the maps, the news, the cards, the CEWARN methodology).

The only thing it doesn't do alone: press "send". A human presses that button. The AI does 95% of the work; the human approves.

## PART 3 — THE ARCHITECTURE (technical and detailed)

### 3.1 The domain model: the Situation entity

The entire system operates over a single domain entity that traverses the complete cycle. This is what makes the pieces feel integrated rather than four tools bolted together: they don't share a UI, they share an object.

```
Situation
├── id
├── geometry (affected zone: CEWARN cluster, sub-ecosystem or cell)
├── hazard_type (rain_deficit | vegetation_stress | heat | flooding |
│                 conflict_pressure)
├── severity + confidence
├── prediction (conflict only)
│   ├── conflict_probability (0-1)
│   ├── expected_incidents (count)
│   └── risk_score (red | orange | yellow)
├── explanation (derived from SHAP → prose: "high risk because X, Y, Z")
├── exposure_snapshot (population, clinics, schools, wells) → feeds Tabiri card
├── unstructured_signals[] (derived from news, marked "unconfirmed")
├── lifecycle_status (detected → assessed → proposed → approved →
│                    dispatched → acknowledged → resolved)
├── recommended_actions[]
└── dispatched_alerts[] (channel, language, recipient, delivery_status, ack_status)
```

The lifecycle is integration made visible. Each Situation has a timeline: detected at T, assessed at T+1, proposed by AI at T+2, approved by human at T+3, dispatched at T+4, acknowledged at T+5. The proposed status explicitly models the human gate: the AI drafted the alert and action, but waits for approval before moving to approved.

- The environmental map creates environmental Situations.
- The conflict model creates conflict_pressure Situations.
- Tabiri reads the exposure_snapshot of any critical Situation and renders the card.
- Onya reads approved Situations and dispatches, writing to dispatched_alerts[].
- The advisor reasons about all Situations.

### 3.2 The AI stack (here lives the answer to your costs)

The key decision, correcting the framing of "RAG + Opus instead of a model": they are two complementary layers, not one substituting the other.

#### Quantitative layer (the numbers) — cheap, explainable, defensible

A gradient boosting model (LightGBM) produces the three outputs. Why this choice and not a custom deep learning model or an LLM:

- It's not expensive. Trains in minutes on a laptop over ~10 years of tabular/geographic data. Compute cost: practically zero.
- It's not inferior to "a ready-made model". There is no ready-made model that predicts conflict for CEWARN clusters from these inputs. Gradient boosting is the tabular prediction domain standard. ACLED's own CAST uses statistical/ML methods.
- It's fully explainable via SHAP: breaks down each forecast into each variable's contribution ("+0.3 for rainfall deficit, +0.2 for NDVI drop, +0.15 for incident trend"). That decomposition is the prose explanation the operator sees.

The three outputs, technically:

- Classifier → P(conflict event in zone in next 3–4 weeks) = conflict_probability
- Regressor → expected incident count = expected_incidents
- Calibrated composite score (probability × severity, or separate ordinal model) → mapped to red/orange/yellow

Training data: for each (zone, week), variables are rainfall stats (current + lagged), NDVI stats (lagged 1 month per CEWARN), recent incident counts and trends, and seasonal indicators. The label is whether conflict occurred in the next 3–4 weeks (binary) + count (regression). ~10 years × clusters × weeks = plenty of rows.

Validation: strict temporal split (train early years, test recent ones) — never random on time series. Comparison against ACLED CAST baseline. Report metrics (AUC, calibration, count error). This is rigorous, defensible, and impresses a technical jury. "Our model vs. the official ACLED forecast" is a winning slide.

#### Language layer (Opus 4.8 + RAG) — where your instinct was right

The powerful LLM does the four language tasks a numeric model can't:

1. Read unstructured news → structured signals. RAG fits perfectly here: retrieve relevant news from the zone, extract the signals, anchor them. The LLM never invents — it cites the source article.
2. Draft + translate voice alerts for each community, in its language.
3. The advisor / brief generation in exact CEWARN format (Mean RFE / Max RFE / incident count / risk categorization).
4. Translate the SHAP explanation to readable prose for the operator.

Why RAG and not just the LLM: RAG keeps the LLM anchored to your sources (news corpus, CEWARN methodology PDF, current map state, exposure cards). The advisor answers "the most urgent zone is Mandera West because [actual map data]", not hallucination. Everything it claims, it can cite.

The human gate: the LLM proposes (drafts and translates alert, prepares sending), but state never moves from proposed to approved without a human. The "send" button is human. This is the only safeguard we decided to build (we leave signature/provenance and full audit as roadmap).

#### Division summary

| Task | Engine | Why |
|---|---|---|
| 3 numbers (probability, incidents, score) | LightGBM + SHAP | Cheap, domain standard, explainable, defensible |
| Comparison baseline | ACLED CAST (consumed) | Methodological credibility |
| News → signals | Opus 4.8 + RAG | NLU on unstructured text |
| Draft + translate alerts | Opus 4.8 | Multilingual NLG |
| Advisor + CEWARN briefs | Opus 4.8 + RAG | Reasoning anchored to our sources |
| Prose explanation | Opus 4.8 (translates SHAP) | Natural language from numbers |

### 3.3 The data pipeline

**Sources (all verified as available and near-real-time)**

| Input | Source | Cadence | Access | Role |
|---|---|---|---|---|
| Conflict incidents | ACLED | Weekly | REST API + Python wrapper acled; free account | Model core + validation |
| Forecast baseline | ACLED CAST | Monthly | Same API | Comparison |
| Rainfall | CHIRPS v3 | ~5 days (dekadal) | Open S3 bucket af-south-1, public domain | Climate input |
| Vegetation | MODIS NDVI (MOD13Q1, 250m) | 16 days, near-present | Google Earth Engine, free nonprofit | The 1-month lag |
| Heat | CHIRTS-daily | Daily | Public (CHC/UCSB) | Thermal stress layer |
| Flooding (consumed) | GloFAS / NASA NRT Flood | Daily/continuous | Public | Ready-made flood layer |
| Population density | WorldPop | Annual | Open | Exposure card |
| Infrastructure | OpenStreetMap (clinics, schools, roads, wells) | Continuous | Open | Exposure card |
| Humanitarian layers | HDX | Variable | Open | Complementary exposure |
| Impact thresholds | ICPAC ibf-thresholds-triggers (GitHub) | — | Open source | Hazard→impact logic from the hosts themselves |

Single real source ingested live (research demands it): ACLED via its API for conflict, and CHIRPS from S3 for rainfall. Both robust.

**The alignment challenge (the real engineering part)**

The three main sources have different temporal granularities: CHIRPS is dekadal (10 days), NDVI is 16-day composite, ACLED is daily by event. The real work is aligning them to a common grid + time index, applying the 1-month vegetation lag CEWARN describes. This is done with xarray + rasterio for rasters and pandas for events, aggregating everything to the zone unit (cluster/cell) per time window.

**Batch vs. seeded**

Real pipeline running in batch per cycle (when new dekadal data arrives), plus a seeded dataset with real historical Mandera data as backup. The demo never depends on a live feed that could die during evaluation. Demo resilience is your senior edge — a dead live feed sinks a demo; a real curated backup shields it.

### 3.4 The last-mile system (Onya)

- **Provider:** Africa's Talking — actually used in the region, with real Kenya numbers. Speaks the jury's language better than a US alternative.
- **Voice flow:** alert text (generated by Opus 4.8, translated to Swahili) → text-to-speech → automatic call via Africa's Talking → voice menu: "press 1 if you received and will act" → digit capture → ack written to alert_deliveries[].ack_status.
- **Dispatch idempotence:** each alert has a unique ID; dispatch is idempotent so you never double-call or drop an alert. This is the kind of detail that separates you from student teams.
- **The ack closes the loop:** when the digit arrives, the Situation status moves to acknowledged and the map reflects the color change in real-time (via WebSocket/polling).

### 3.5 The technology stack

Optimized for one dev in 3 weeks — minimize runtime context-switching.

- **Frontend:** React + TypeScript. Map with MapLibre GL JS (open source, no token, handles layers and choropleth smoothly; aligns with the open-source spirit ICPAC values).
- **Backend:** Python + FastAPI as sole server-side backend — data, ML, LLM orchestration, and Onya dispatch. One language/runtime on server reduces context-switch for one dev. (Alternative: separate orchestration to Node/TS, but for solo work, one backend is cleaner.)
- **Database:** PostgreSQL + PostGIS — the cross "hazard zone × population/infrastructure" is a spatial query; PostGIS is the right tool. Stores cluster geometries, exposure, and Situations.
- **Geographic data:** xarray + rasterio to process rasters (CHIRPS/NDVI) → aggregated by zone → stored in PostGIS or as precalculated GeoJSON for the map.
- **ML:** LightGBM + SHAP.
- **LLM:** Opus 4.8 via API, with RAG over news corpus + CEWARN methodology PDF + map state.
- **Voice/SMS:** Africa's Talking.
- **Realtime:** WebSocket (or simple polling) for acks to update the map live.
- **Hosting:** small cloud instance serving FastAPI + React build, with managed Postgres/PostGIS or same instance.

### 3.6 Cost analysis (explicit)

| Concept | Cost | Note |
|---|---|---|
| Model training | ~$0 | LightGBM trains on laptop in minutes |
| Data | $0 | All public or free-with-registration |
| LLM inference (Opus 4.8) | A few $ | Demo volume: some news, some alerts, advisor conversations |
| Voice/SMS (Africa's Talking) | ~$5–20 | Pay-per-use; tests at low volume |
| Hosting | $0–30/mo | Free tier or small instance |
| **Total build + demo** | **Tens of dollars** | Dominated by LLM inference and hosting, both trivial at demo scale |

The fear of "expensive custom model" was misdirected: the custom part (gradient boosting) is the cheap one. What would be expensive/risky is trying an LLM to do numeric forecasting — and that's exactly what we avoid.

## PART 4 — ARCHITECTURE DECISION REGISTER

What we already agreed on, with the why:

1. Causal framing, not two products. The environmental layer is the visible input to the conflict model. One predictive brain (conflict); many visible layers with cards. → Avoids scatter, and the causal chain is the differentiator.

2. Deep loop only in conflict. Predict → card → approve → call → confirm, complete only for conflict. Consumed-ready flooding, shown with card but no own pipeline. → Visual impact without the cost of modeling water.

3. Numbers by gradient boosting, language by LLM. LightGBM+SHAP for 3 outputs; Opus 4.8+RAG for news, alerts, advisor, explanations. → Cheap, explainable, defensible; LLM where it shines.

4. Explainable-first with heavyweight AI. Not "less AI" — AI that shows its reasoning. → A jury with IDDRSI/CEWARN distrusts black boxes firing conflict alerts.

5. 3–4 week horizon. The rainfall→vegetation→conflict lag of CEWARN's own model. → Defensible because we didn't invent it.

6. Seeded news, not live scraper. Real curated Mandera corpus. → Demo shield.

7. Voice as hero channel; Swahili first. Africa's Talking. → Most impressive, reaches illiterates, speaks the jury's language.

8. Keypad ack → map color changes live. → The demo moment that makes closure feel real.

9. Lateral advisor with map context; can do everything except send. → Separated would lose the context that makes it useful.

10. Only built-in safeguard: mandatory human approval before sending. Signature/provenance and full audit stay as roadmap. → Scope focus; the safety red line that actually matters.

11. Protagonist cluster: Mandera. → Tri-border, visually clear drought, cleanest causal chain.

12. Regional map + zoom. → Wide for context, deep in one spot.

## PART 5 — 3-WEEK PLAN

Absolute priority: one impeccable end-to-end slice, not ten half-baked. The order is designed so if something gets cut, what remains still closes the cycle.

### Week 1 — Data + brain

- Real ingestion: ACLED (API) + CHIRPS (S3) + NDVI (GEE) for Mandera.
- Alignment to grid+time with 1-month lag.
- Train LightGBM, validate temporally, compare against CAST.
- SHAP working (explanations).
- Fallback: if alignment drags, a transparent weighted index calibrated on history also produces 3 outputs and also explains. Trained model is the goal; the index is insurance.
- Deliverable: Mandera seeded dataset + model producing 3 explained outputs.

### Week 2 — Map + cards + Onya

- MapLibre with regional view + zoom to Mandera; 4 environmental layers + consumed flooding.
- Exposure cross in PostGIS → Tabiri cards on critical zones.
- Onya: voice flow with Africa's Talking, Swahili, and keypad ack → map color change.
- Deliverable: visible cycle — red zone → card → (approval) → call → ack → green.

### Week 3 — Language AI + polish + demo

- Seeded news corpus; signal extraction with Opus 4.8 + RAG; "unconfirmed" markers raising risk.
- Lateral advisor: prioritizes, drafts CEWARN brief, prepares alert. Human gate to send.
- Polish: clean documented repo, clear README.
- Record video against seeded dataset (never live feed). Script the ack moment.
- Write two 250-word summaries (overview + solution) — cheap points most overlook.

**What ships polished vs. demonstrated:** polished = entire conflict cycle in Mandera (explainable prediction → card → Swahili voice → ack → map). Demonstrated (shown but not exhaustive) = extra environmental layers, other voice languages (one parameter), WhatsApp/SMS as backup.

## PART 6 — RISKS AND MITIGATIONS

| Risk | Mitigation |
|---|---|
| Live feed dies during evaluation | Seeded dataset with real data; video already recorded against it |
| Model training drags | Transparent weighted-index fallback also producing 3 outputs |
| Scope creeps (the "if it doesn't get too big") | Deep cycle only in conflict; consumed flooding; one reusable card; one full language |
| Voice call fails live | Pre-recorded video of full flow; live call as bonus, not dependency |
| False conflict alert (real harm risk) | AI marks signals but never fires alone; mandatory human approval |
| One dev, time crunch | One Python backend, work order preserves cycle if cut, fallbacks each week |

## PART 7 — OPEN DECISIONS (what's left to define)

None are blocking to start, but good to close soon:

1. Final name of platform (working proposal: Dira).
2. Exact spatial unit of model: full CEWARN cluster, sub-ecosystem, or grid cell below? (Recommendation: cell for computation, cluster/sub-ecosystem for narrative and alerts.)
3. Confirm ACLED account access level you'll get (level affects whether you receive event-by-event or aggregates; register with institutional email for higher access).
4. CHIRPS v2 vs v3 (v2 ends production after December 2026; use v3 for continuity).
5. One Python backend vs. separating orchestration to Node/TS — I recommend one for solo, but your call by comfort.
6. Visual design of map — if you want, the next step can be an interface sketch (where advisor goes, how cards look, color transition of ack).

## Appendix — Source access notes

- **ACLED** — acleddata.com; REST API with OAuth, Python acled wrapper (PyPI, active Apr-2026), free myACLED account, pagination 5000 rows/call. Covers all the Horn. Includes CAST (forecast) and Conflict Exposure Calculator (ACLED×WorldPop). Terms: mandatory attribution; restricts commercial derivatives — OK for non-commercial hackathon.
- **CHIRPS** — chc.ucsb.edu/data/chirps; public domain. Open S3 bucket via Digital Earth Africa (s3://deafrica-input-datasets/rainfall_chirps_*, region af-south-1, --no-sign-request), cloud-optimized GeoTIFFs. Also on FAO WaPOR. ICPAC hosts it.
- **MODIS NDVI** — Google Earth Engine (MODIS/061/MOD13Q1, 250m, 16 days); LP DAAC data unrestricted use/redistribution; GEE free for research/nonprofit.
- **CHIRTS (temperature)** — chc.ucsb.edu; public.
- **GloFAS** — globalfloods.eu (European Commission + ECMWF); global hydrological forecast.
- **NASA NRT Global Flood Mapping** — Africa coverage, near-real-time.
- **WorldPop** — worldpop.org; population density, open.
- **OpenStreetMap** — clinics, schools, roads, wells; open.
- **HDX** — data.humdata.org; humanitarian layers.
- **ICPAC GitHub** — github.com/icpac-igad; key repos: ibf-thresholds-triggers (hazard→impact thresholds), climatechange-api and latest-imagery-api (Hazards Watch microservices), E4DRR, DevOps-hazard-modeling, SEWAA-forecasts.
- **East Africa Hazards Watch** — eahazardswatch.icpac.net; v2.0 (May-2025) added heat stress and better data accessibility; built on open-source stack with consumable microservices.
- **CEWARN** — Climate-Induced Conflict Monthly Alert methodology (March 2026 PDF in your project): structure of Mean RFE / Max RFE / incident count / risk categorization by cluster.

Figures and availability are mid-2026; verify recent ICPAC/ACLED/FEWS NET releases before citing numbers in deliverables.
