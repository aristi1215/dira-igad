/**
 * Anchor ids for the guided tour.
 *
 * The tour finds its targets with `[data-tour="<id>"]` rather than a ref
 * registry: no prop drilling across eight screens, it survives remounts on
 * route change, and it does not fight the React Compiler. The cost is that a
 * deleted attribute fails silently — hence these constants (so steps and JSX
 * cannot drift) plus a test asserting every id is actually present in `src/`.
 */
export const TOUR_ANCHORS = {
  brand: 'brand',
  askDira: 'ask-dira',
  mapCanvas: 'map-canvas',
  mapOverlays: 'map-overlays',
  mapWatchlist: 'map-watchlist',
  mapZoneCard: 'map-zone-card',
  twoScore: 'two-score',
  shapDrivers: 'shap-drivers',
  approvalGate: 'approval-gate',
} as const

export type TourAnchor = (typeof TOUR_ANCHORS)[keyof typeof TOUR_ANCHORS]

export function anchorSelector(anchor: TourAnchor): string {
  return `[data-tour="${anchor}"]`
}
