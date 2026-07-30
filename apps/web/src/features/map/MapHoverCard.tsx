import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { placeNearPoint, type Placement } from '../../lib/anchor'
import {
  BAND_LABELS,
  BAND_MAP_COLORS,
  COUNTRY_NAMES,
  fmtCompact,
  fmtRiskScore,
  IPC_LABELS,
} from '../../lib/format'
import { featureMeta } from '../../lib/explain'
import type {
  MapOverlay,
  RegionalIndicatorProperties,
  ShapBreakdown,
  ZoneTrendPoint,
} from '../../lib/types'
import { T } from '../../lib/motion'
import { Sparkline } from '../../components/ui'

/**
 * The line that answers whatever question the active overlay is asking. That
 * is what makes the overlay switcher feel like it changes the map's subject
 * rather than just its colors.
 */
function overlayLine(overlay: MapOverlay, zone: RegionalIndicatorProperties): string {
  switch (overlay) {
    case 'ipc':
      return zone.ipc_phase
        ? `IPC ${zone.ipc_phase} · ${IPC_LABELS[zone.ipc_phase] ?? ''}${
            zone.pop_phase3_plus ? ` — ${fmtCompact(zone.pop_phase3_plus)} in phase 3+` : ''
          }`
        : 'No food security classification'
    case 'displacement':
      return `${fmtCompact(zone.idps)} displaced${
        zone.refugees ? ` · ${fmtCompact(zone.refugees)} refugees` : ''
      }`
    case 'incidents':
      return `${zone.incidents_180d ?? 0} incidents · ${zone.fatalities_180d ?? 0} killed, last 180 days`
    case 'hazards':
      return `${zone.active_hazards ?? 0} active hazard bulletin${
        zone.active_hazards === 1 ? '' : 's'
      }${zone.active_health_alerts ? ` · ${zone.active_health_alerts} health alert` : ''}`
    case 'markets':
      return zone.staple_pct_vs_3m_avg == null
        ? 'No recent staple price'
        : `${zone.staple_commodity ?? 'Staple'} ${
            zone.staple_pct_vs_3m_avg > 0 ? '+' : ''
          }${Math.round(zone.staple_pct_vs_3m_avg)}% vs 3-month average`
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
  trend,
  shap,
}: {
  zone: RegionalIndicatorProperties
  point: { x: number; y: number }
  overlay: MapOverlay
  trend?: ZoneTrendPoint[]
  shap?: ShapBreakdown
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const box = ref.current.getBoundingClientRect()
    setPlacement(placeNearPoint(point, { width: box.width, height: box.height }))
  }, [point])

  const band = zone.operational_band ?? 'none'
  const color = BAND_MAP_COLORS[band]

  // The two features the model leaned on hardest. Already fetched with every
  // situation and, until now, only ever visible three clicks deep.
  const drivers = Object.entries(shap ?? {})
    .map(([feature, value]) => ({ feature, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)

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
      className="pointer-events-none fixed z-tooltip w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-panel"
    >
      <span aria-hidden className="block h-0.5 w-full" style={{ background: color }} />

      <div className="p-2.5">
        <p className="text-md leading-tight font-semibold tracking-[-0.01em] text-ink">
          {zone.zone_name}
        </p>
        <p className="mt-0.5 text-2xs text-faint">
          {COUNTRY_NAMES[zone.country_iso2] ?? zone.country_iso2}
        </p>

        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="flex items-baseline gap-1.5">
            <span
              className="text-xl leading-none font-semibold tabular-nums"
              style={{ color }}
            >
              {zone.model_risk != null ? fmtRiskScore(zone.model_risk) : '—'}
            </span>
            <span className="text-2xs text-faint">/ 100</span>
          </span>
          <Sparkline
            values={(trend ?? []).map((entry) => entry.model_risk)}
            width={56}
            height={20}
            color={color}
          />
        </div>

        <p className="mt-1 text-2xs font-medium" style={{ color }}>
          {BAND_LABELS[band]}
        </p>

        <p className="mt-2 border-t border-line pt-2 text-2xs text-muted">
          {overlayLine(overlay, zone)}
        </p>

        {drivers.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {drivers.map(({ feature, value }) => (
              <li
                key={feature}
                className="flex items-baseline justify-between gap-2 text-2xs"
              >
                <span className="truncate text-faint">{featureMeta(feature).label}</span>
                <span
                  className={`shrink-0 tabular-nums ${
                    value >= 0 ? 'text-err-fg' : 'text-ok-fg'
                  }`}
                >
                  {value >= 0 ? '+' : '−'}
                  {Math.abs(value).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </motion.div>
  )
}
