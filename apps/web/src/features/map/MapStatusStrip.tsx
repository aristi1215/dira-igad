import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Megaphone } from 'lucide-react'
import { BAND_LABELS, BAND_MAP_COLORS, BAND_ORDER, fmtCompact } from '../../lib/format'
import type { OperationalBand, ZoneSummary } from '../../lib/types'
import { cx } from '../../lib/cx'

/**
 * The bottom edge of the map.
 *
 * That strip used to be empty basemap. It now carries the regional totals a
 * duty officer would otherwise have to leave the map to find: how the 22 zones
 * are distributed, how many people are in the zones that need attention, and
 * whether anything is sitting unapproved.
 *
 * Every segment is also a filter, so the summary doubles as the coarsest
 * control on the screen.
 */
export function MapStatusStrip({
  zones,
  cycle,
  pendingAlerts,
  bandFilter,
  onToggleBand,
}: {
  zones: ZoneSummary[]
  cycle: string | null
  pendingAlerts: number
  bandFilter: Set<OperationalBand> | null
  onToggleBand: (band: OperationalBand) => void
}) {
  const summary = useMemo(() => {
    const counts = new Map<OperationalBand, number>()
    let attentionPopulation = 0
    let assessed = 0

    for (const zone of zones) {
      const band = zone.operational_band
      if (!band) continue
      assessed += 1
      counts.set(band, (counts.get(band) ?? 0) + 1)
      // "Needs attention" is elevated and above — the same threshold the
      // watchlist and the guidance copy use. Keep them in step.
      if (band === 'elevated' || band === 'high' || band === 'very_high') {
        attentionPopulation += zone.population ?? 0
      }
    }

    const segments = BAND_ORDER.filter(
      (band): band is OperationalBand => band !== 'none',
    )
      .map((band) => ({ band, count: counts.get(band) ?? 0 }))
      .filter((segment) => segment.count > 0)

    const needAttention =
      (counts.get('very_high') ?? 0) + (counts.get('high') ?? 0) + (counts.get('elevated') ?? 0)

    return { segments, assessed, needAttention, attentionPopulation }
  }, [zones])

  if (summary.assessed === 0) return null

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-map-ui flex h-11 items-center gap-4 border-t border-line bg-surface/92 px-4 backdrop-blur-sm">
      <Readout
        label="Need attention"
        value={`${summary.needAttention}`}
        detail={`of ${summary.assessed} zones`}
      />
      <Divider />
      <Readout
        label="People exposed"
        value={fmtCompact(summary.attentionPopulation)}
        detail="in those zones"
      />
      <Divider />

      {/* The distribution, at a width that makes the proportions readable. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="font-condensed shrink-0 text-2xs font-semibold tracking-[0.09em] text-faint uppercase">
          Distribution
        </span>
        <div className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full">
          {summary.segments.map((segment) => {
            const active = !bandFilter || bandFilter.has(segment.band)
            return (
              <button
                key={segment.band}
                type="button"
                onClick={() => onToggleBand(segment.band)}
                aria-pressed={active}
                title={`${segment.count} zones — ${BAND_LABELS[segment.band]}`}
                className={cx(
                  'h-full transition-[opacity,flex-grow] duration-[240ms] ease-standard hover:brightness-110',
                  !active && 'opacity-25',
                )}
                style={{
                  flexGrow: segment.count,
                  background: BAND_MAP_COLORS[segment.band],
                }}
              />
            )
          })}
        </div>
      </div>

      <Divider />
      {cycle ? (
        <span className="shrink-0 font-mono text-2xs tabular-nums text-faint">
          Cycle {cycle}
        </span>
      ) : null}

      {pendingAlerts > 0 ? (
        <Link
          to="/dispatch"
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-2 py-1',
            'text-2xs font-medium text-ink transition-colors duration-[120ms] ease-standard',
            'hover:border-accent hover:bg-accent-soft hover:text-accent-deep',
          )}
        >
          <Megaphone size={13} strokeWidth={1.75} aria-hidden />
          <span className="font-mono tabular-nums">{pendingAlerts}</span>
          awaiting approval
          <ArrowRight size={12} strokeWidth={2} aria-hidden />
        </Link>
      ) : null}
    </div>
  )
}

function Readout({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span className="font-condensed text-2xs font-semibold tracking-[0.09em] text-faint uppercase">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums text-ink">{value}</span>
      <span className="hidden text-2xs text-faint lg:inline">{detail}</span>
    </span>
  )
}

function Divider() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-line" />
}
