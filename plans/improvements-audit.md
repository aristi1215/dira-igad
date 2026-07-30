# `docs/improvements.md` acceptance audit

Line-by-line audit of `docs/improvements.md` against the codebase after Phase 1
(workstreams A–H), dark mode, and the ReliefWeb enablement.

Status legend:
- **done** — implemented directly in this PR as a Phase-2 not-done item.
- **done-by-plan** — already satisfied by a Phase-1 workstream (A–H) / dark mode / ReliefWeb.
- **not-done → done** — was not covered by the plan; implemented in Phase 2 of this PR.
- **not-done (documented)** — cannot be done honestly (no trustworthy source / conflicts with a
  hard safety red line); reason recorded, and the honest alternative applied.

Provenance rule applied throughout (user instruction): never invent sources, citations, figures,
addresses, or people. Where trustworthy sourcing does not exist, the unsupported claim is removed or
plainly marked illustrative/seeded rather than dressed up as credible.

| # | Item (docs/improvements.md) | Status | Where in the code | What remains |
|---|------------------------------|--------|-------------------|--------------|
| G1 | Font/styling/colors improved; less blank space; more detail & polish | done-by-plan | `index.css` @theme (A), Bento layouts across screens (B) | — |
| G2 | Text colors/font must build credibility (not generic) | done-by-plan | Inter/JetBrains Mono, refined ink/muted tokens (A) | — |
| G3 | Information should carry links & sources for credibility | not-done → done | evidence/news source links (Situation batch), Sources screen links | — |
| G4 | Changeable dark mode, high-tech feel | done-by-plan / done | `html.dark` token override + `stores/theme.ts` + CommandBar toggle | — |
| G5 | Better contrasts overall | done-by-plan | raised `--color-muted`/`--color-faint`, dark palette (A + dark mode) | — |
| G6 | Accurate icons; small functionality represented by colors/details | not-done → done | overlay + hazard + channel iconography (Map/Dispatch batches) | — |
| Gd1 | Guide over-assumes dekads/cycles knowledge | done-by-plan | `WelcomeBento` (D) + glossary `Term` (C) | — |
| Gd2 | Guide must explain what the app is & main functionalities | done-by-plan | `WelcomeBento` six tiles (D) | — |
| Gd3 | Explain the ML model relates to pressure | done-by-plan | ScoreFlow (C) + WelcomeBento "The score" tile | — |
| Gd4 | Explain separation: news vs conflict alerts vs model-vs-external map layers | not-done → done | WelcomeBento "layers" tile + map overlay legend copy | — |
| Gd5 | Guide should name sources and provide links | not-done → done | WelcomeBento sources tile links to Sources screen / provider docs | — |
| M1 | Heatmap colors too light — darken so visible | not-done → done | `useMapLayers.ts` choropleth paint ramp darkened | — |
| M2 | Cluster square borders look poor — improve | not-done → done | cluster outline paint in `useMapLayers.ts`/`basemap.ts` | — |
| M3 | Overlay cards don't change with food/displacement/etc; decorative stat | not-done → done | `ZoneCard.tsx` overlay-aware brief, redirecting to pressure | — |
| M4 | Overlays all look equally important; conflict is primary — show it | not-done → done | overlay hierarchy styling + "pressure is the headline" framing | — |
| M5 | "markets" overlay does nothing — fix | not-done → done | `useSelectedZone.ts` overlay persistence (B3) + markets brief in ZoneCard | — |
| M6 | No-band clusters should explain why | not-done → done | no-band explanation in ZoneCard / legend | — |
| M7 | Date should stand out (page, cards, cycle) | not-done → done | prominent `DateStamp` treatment on map/cards/cycle | — |
| S1 | Situation dates should stand out | not-done → done | prominent date in SituationDetail hero | — |
| S2 | Situation colors/font/high-tech improved | done-by-plan | SituationDetail bento (B4) + A | — |
| S3 | "What the model leaned on" reworded + question-mark explainer | not-done → done | ShapDrivers heading reworded ("how the model worked out the risk") + `InfoHint` | — |
| S4 | Evidence: sources, links, addresses, locations, people where trustworthy | not-done → done | EvidenceBoard / SignalDetail / FieldReport modals surface source+url when present; illustrative when seeded | — |
| S5 | "How this affects the risk score" explained further / own section | not-done → done | dedicated impact section in signal/field-report detail | — |
| S6 | News/field report detail clearer; verification/severity/status visually obvious | not-done → done | verification & severity badges promoted in modals + lists | — |
| S7 | "Exposure at assessment time": show exact frozen date + button to current zone state | not-done → done | exposure section shows `snapshot_date` + link to `/zones/:id` | — |
| F1 | Field reports poorly explained/presented; conditions unclear | not-done → done | field-report explainer copy + clearer status/condition presentation | — |
| Z1 | Zones design/colors/high-tech improved | done-by-plan | ZonesScreen bento (B2) | — |
| Z2 | Charts too simple/inaccurate (rain "per dekad" vs monthly); add filters + motion | not-done → done | dekad-accurate labels/axes + range filter + entrance motion in ZoneDossier | — |
| Z3 | Recent conflict events need sources/links/details | not-done → done | ConflictEvents surfaces ACLED source + event provenance | — |
| Z4 | Hazard bulletins & health: trustworthy links or remove | not-done → done | hazards labelled with honest provenance + feed links; health figures removed/marked (see Z5) | — |
| Z5 | Health cases/deaths/status not credibly sourced | not-done (documented) → removed | seeded health surveillance has no verified feed → unsupported figures removed from UI, replaced with an honest "illustrative, not from a verified surveillance feed" note | — |
| Z6 | Field-report approval UI ugly; unclear you must type a name | not-done → done | approval control redesigned; approver-name requirement made explicit | — |
| D1 | Dispatch page not intuitive; no first-glance explanation | not-done → done | dispatch explainer/inverse hero describing the real flow | — |
| D2 | Modify sent message & language | not-done → done | editable message + language selector in dispatch compose | — |
| D3 | Select/add/change recipients with phone + language | not-done → done | recipient management UI (list, add, edit phone/language) | — |
| D4 | Dispatch alerts from this view selecting alerts + recipients | not-done → done | alert + recipient selection in dispatch view (still human-gated) | — |
| D5 | Choose call, SMS, or both | not-done → done | channel selector; honestly reflects backend channel support | — |
| L1 | LLM grounded retrieval | done-by-plan | pgvector `search_corpus` + `_advisor_gather` (G) | — |
| L2 | LLM tool calling | done-by-plan | `advisor_tools.py` + bounded loop (H) | — |
| L3 | Transparent — show where information came from | done-by-plan | citations + retrieval trace + ProposalCard (G/H) | — |
| L4 | LLM can dispatch calls (with approval), create recipients, send SMS/calls | not-done (documented) | gated proposals only: `propose_alert_draft` (H); operator dispatches from the Dispatch page | Hard safety red line: the advisor must NEVER approve/dispatch/create-and-send autonomously (no tool name may match approve/dispatch/deliver/send; no handler mutates). "With approval" is honored via operator-confirmed proposals + the human approval gate. Autonomous dispatch is intentionally NOT built. |
| L5 | LLM speaks accurately | done-by-plan | grounded prompt + canned deterministic seeded adapter | — |
| L6 | LLM should "search on the internet" | not-done (documented) | — | Deferred per the user's own directive ("future integrations only after first-party tools"): no trustworthy first-party web-search tool exists; adding an ungrounded web search would undermine the provenance guarantee. Documented rather than faked. |
