import { Activity, Swords, TriangleAlert, Users, Wheat } from 'lucide-react'
import { Tabs, type TabItem } from '../../components/ui'
import type { MapOverlay } from '../../lib/types'
import { TOUR_ANCHORS } from '../tour/tourAnchors'

const OVERLAYS: TabItem<MapOverlay>[] = [
  { id: 'pressure', label: 'Pressure', icon: Activity },
  { id: 'ipc', label: 'Food', icon: Wheat },
  { id: 'displacement', label: 'Displaced', icon: Users },
  { id: 'incidents', label: 'Incidents', icon: Swords },
  { id: 'hazards', label: 'Hazards', icon: TriangleAlert },
]

/**
 * One short line saying what the color currently means. It sits directly under
 * the control that caused the color, so it reads as an axis label rather than
 * as a banner — the map should explain itself without lecturing.
 */
const CAPTIONS: Record<MapOverlay, string> = {
  pressure: 'Shading: forecast conflict pressure, next 30 days',
  ipc: 'Shading: IPC acute food insecurity phase',
  displacement: 'Shading: people displaced, latest snapshot',
  incidents: 'Shading: conflict incidents, last 180 days',
  hazards: 'Shading: active hazard bulletins',
}

export function MapToolbar({
  overlay,
  onChange,
}: {
  overlay: MapOverlay
  onChange: (overlay: MapOverlay) => void
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
        className="shadow-panel"
      />
      <p className="rounded-full bg-surface/85 px-2.5 py-0.5 text-2xs text-muted backdrop-blur-sm">
        {CAPTIONS[overlay]}
      </p>
    </div>
  )
}
