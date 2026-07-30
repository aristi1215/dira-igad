import { Activity, Coins, Swords, TriangleAlert, Users, Wheat } from 'lucide-react'
import { Tabs, type TabItem } from '../../components/ui'
import type { MapOverlay } from '../../lib/types'
import { TOUR_ANCHORS } from '../tour/tourAnchors'

const OVERLAYS: TabItem<MapOverlay>[] = [
  { id: 'pressure', label: 'Pressure', icon: Activity },
  { id: 'ipc', label: 'Food', icon: Wheat },
  { id: 'displacement', label: 'Displaced', icon: Users },
  { id: 'incidents', label: 'Incidents', icon: Swords },
  { id: 'hazards', label: 'Hazards', icon: TriangleAlert },
  { id: 'markets', label: 'Markets', icon: Coins },
]

/**
 * One short line saying what the color currently means. It sits directly under
 * the control that caused the color, so it reads as an axis label rather than
 * as a banner — the map should explain itself without lecturing.
 *
 * Each caption also names the *unit* the shading is drawn on, because the map
 * now mixes two: zone tint is a per-zone aggregate, while the heat field is
 * kernel density over individual event coordinates. Blurring that distinction
 * would let a smoothed picture pass for spatial precision the data lacks.
 */
const CAPTIONS: Record<MapOverlay, string> = {
  pressure: 'Zone shading: forecast conflict pressure, next 30 days',
  ipc: 'Zone shading: IPC acute food insecurity phase',
  displacement: 'Zone shading: people displaced, latest snapshot',
  // The window is data-dependent, so the legend states it rather than this
  // caption pretending to a fixed range.
  incidents: 'Heat: density of individual recorded conflict events',
  hazards: 'Zone shading: active hazard bulletins',
  markets: 'Zone shading: staple price vs its own 3-month average',
}

export function MapToolbar({
  overlay,
  onChange,
  showHazards,
  onToggleHazards,
}: {
  overlay: MapOverlay
  onChange: (overlay: MapOverlay) => void
  showHazards: boolean
  onToggleHazards: () => void
}) {
  return (
    <div
      className="pointer-events-auto absolute top-3 left-1/2 z-map-ui flex -translate-x-1/2 flex-col items-center gap-1.5"
      data-tour={TOUR_ANCHORS.mapOverlays}
    >
      <Tabs
        items={OVERLAYS}
        value={overlay}
        onChange={onChange}
        layoutId="map-overlay"
        ariaLabel="Map overlay"
        className="rounded-full border border-line bg-surface/92 shadow-panel backdrop-blur-xl"
      />
      <button
        type="button"
        aria-pressed={showHazards}
        onClick={onToggleHazards}
        className="rounded-full border border-line bg-surface/92 px-2.5 py-1 text-2xs font-medium text-muted shadow-panel backdrop-blur-xl transition-colors hover:bg-surface-2 hover:text-ink"
      >
        {showHazards ? 'Hide hazard pins' : 'Show hazard pins'}
      </button>
      <p className="rounded-full border border-line bg-surface/92 px-2.5 py-0.5 text-2xs text-muted shadow-panel backdrop-blur-xl">
        {CAPTIONS[overlay]}
      </p>
    </div>
  )
}
