import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { placeNearPoint, type Placement } from '../../lib/anchor'
import { BAND_LABELS, BAND_MAP_COLORS, COUNTRY_NAMES, fmtCompact, fmtRiskScore, IPC_LABELS } from '../../lib/format'
import type { MapOverlay, RegionalIndicatorProperties } from '../../lib/types'
import { T } from '../../lib/motion'

/**
 * The fourth line answers whatever question the active overlay is asking. That
 * is what makes the overlay switcher feel like it changes the map's subject
 * rather than just its colors.
 */
function overlayLine(
  overlay: MapOverlay,
  zone: RegionalIndicatorProperties,
): string {
  switch (overlay) {
    case 'ipc':
      return zone.ipc_phase
        ? `IPC ${zone.ipc_phase} · ${IPC_LABELS[zone.ipc_phase] ?? ''}${
            zone.pop_phase3_plus ? ` — ${fmtCompact(zone.pop_phase3_plus)} in phase 3+` : ''
          }`
        : 'No food security classification'
    case 'displacement':
      return `${fmtCompact(zone.idps)} displaced`
    case 'incidents':
      return `${zone.incidents_180d ?? 0} incidents, last 180 days`
    case 'hazards':
      return `${zone.active_hazards ?? 0} active hazard bulletin${zone.active_hazards === 1 ? '' : 's'}`
    case 'pressure':
    default:
      return `${zone.verified_field_reports_recent ?? 0} verified field report${
        zone.verified_field_reports_recent === 1 ? '' : 's'
      }`
  }
}

export function MapHoverCard({
  zone,
  point,
  overlay,
}: {
  zone: RegionalIndicatorProperties
  point: { x: number; y: number }
  overlay: MapOverlay
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const box = ref.current.getBoundingClientRect()
    setPlacement(placeNearPoint(point, { width: box.width, height: box.height }))
  }, [point])

  const band = zone.operational_band ?? 'none'

  return (
    <motion.div
      ref={ref}
      role="tooltip"
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={T.fast}
      style={{
        top: placement?.top ?? -9999,
        left: placement?.left ?? -9999,
        visibility: placement ? 'visible' : 'hidden',
      }}
      className="pointer-events-none fixed z-tooltip w-56 rounded-lg border border-line bg-surface p-2.5 shadow-panel"
    >
      <p className="text-sm leading-tight font-semibold text-ink">{zone.zone_name}</p>
      <p className="mt-0.5 text-2xs text-faint">
        {COUNTRY_NAMES[zone.country_iso2] ?? zone.country_iso2}
      </p>

      <p className="mt-2 flex items-center gap-1.5 text-2xs">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: BAND_MAP_COLORS[band] }}
        />
        <span className="font-medium text-ink">{BAND_LABELS[band]}</span>
        {zone.model_risk != null ? (
          <span className="tabular-nums text-faint">{fmtRiskScore(zone.model_risk)}/100</span>
        ) : null}
      </p>

      <p className="mt-1 text-2xs text-muted">{overlayLine(overlay, zone)}</p>
    </motion.div>
  )
}
