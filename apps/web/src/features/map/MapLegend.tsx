import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  BAND_LABELS,
  BAND_MAP_COLORS,
  CHART,
  fmtCompact,
  fmtDate,
  IPC_COLORS,
  IPC_LABELS,
} from '../../lib/format'
import type {
  MapEventWindow,
  MapOverlay,
  OperationalBand,
  RegionalIndicators,
} from '../../lib/types'
import { cx } from '../../lib/cx'
import { HAZARD_ICONS, HAZARD_META, HAZARD_SEVERITY_META } from '../../lib/explain'

const FILTERABLE_BANDS: OperationalBand[] = ['very_high', 'high', 'elevated', 'watch', 'low']

/** Which zone property each sequential overlay reads, and how to say it. */
const RAMPS: Record<
  string,
  { title: string; property: string; format: (value: number) => string }
> = {
  displacement: {
    title: 'People displaced',
    property: 'idps',
    format: (value) => fmtCompact(value),
  },
  incidents: {
    title: 'Incidents per zone',
    property: 'incidents_180d',
    format: (value) => String(Math.round(value)),
  },
  hazards: {
    title: 'Active hazard bulletins',
    property: 'active_hazards',
    format: (value) => String(Math.round(value)),
  },
  markets: {
    title: 'Staple price vs 3-month average',
    property: 'staple_pct_vs_3m_avg',
    format: (value) => `${value > 0 ? '+' : ''}${Math.round(value)}%`,
  },
}

/**
 * For the pressure overlay the legend is also the filter: clicking a band
 * hides the others from both the map and the watchlist. This turns the most
 * decorative element on screen into the primary way to narrow the picture.
 *
 * The sequential overlays get their real distribution plotted over the ramp
 * rather than a bare gradient with invented endpoints. A ramp that says
 * "0 → 50K+" tells you the scale; the distribution tells you whether all 22
 * zones are bunched at one end, which is usually the actual finding.
 */
export function MapLegend({
  overlay,
  indicators,
  eventWindow,
  bandFilter,
  onToggleBand,
  onResetBands,
}: {
  overlay: MapOverlay
  indicators: RegionalIndicators | undefined
  /** The window the event feed actually returned, for the incidents legend. */
  eventWindow: MapEventWindow | undefined
  bandFilter: Set<OperationalBand> | null
  onToggleBand: (band: OperationalBand) => void
  onResetBands: () => void
}) {
  /** Counts per band, so the legend states how many zones each swatch covers. */
  const bandCounts = useMemo(() => {
    const counts = new Map<OperationalBand, number>()
    for (const feature of indicators?.features ?? []) {
      const band = feature.properties.operational_band
      if (band) counts.set(band, (counts.get(band) ?? 0) + 1)
    }
    return counts
  }, [indicators])

  const ramp = RAMPS[overlay]

  /** Every zone's value for the active sequential overlay, plus its range. */
  const distribution = useMemo(() => {
    if (!ramp) return null
    const values = (indicators?.features ?? [])
      .map((feature) => {
        const raw = (feature.properties as unknown as Record<string, unknown>)[ramp.property]
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
      })
      .filter((value): value is number => value != null)

    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    return {
      values: sorted,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)],
    }
  }, [indicators, ramp])

  if (overlay === 'pressure') {
    return (
      <LegendShell
        title="Risk band"
        action={
          bandFilter ? (
            <button
              type="button"
              onClick={onResetBands}
              className="inline-flex items-center gap-1 rounded-xs text-2xs text-accent transition-colors hover:text-accent-hover"
            >
              <RotateCcw size={10} strokeWidth={2} aria-hidden />
              Reset
            </button>
          ) : null
        }
      >
        <ul className="flex flex-col gap-0.5">
          {FILTERABLE_BANDS.map((band) => {
            const active = !bandFilter || bandFilter.has(band)
            const count = bandCounts.get(band) ?? 0
            return (
              <li key={band}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleBand(band)}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-xs px-1 py-1 text-left text-2xs',
                    'transition-colors duration-[120ms] ease-standard hover:bg-surface-3',
                    active ? 'text-ink' : 'text-faint',
                  )}
                >
                  <span
                    aria-hidden
                    className={cx(
                      'size-2.5 shrink-0 rounded-xs transition-opacity duration-[120ms]',
                      !active && 'opacity-25',
                    )}
                    style={{ background: BAND_MAP_COLORS[band] }}
                  />
                  <span className="flex-1">{BAND_LABELS[band]}</span>
                  <span
                    className={cx(
                      'font-mono tabular-nums',
                      count === 0 ? 'text-line-strong' : 'text-muted',
                    )}
                  >
                    {count}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <p className="mt-1.5 border-t border-line pt-1.5 text-2xs leading-relaxed text-faint">
          <span
            aria-hidden
            className="mr-1.5 inline-block size-2 rounded-full align-middle"
            style={{ background: BAND_MAP_COLORS.ack }}
          />
          Badge = open situation · green once acknowledged
        </p>
      </LegendShell>
    )
  }

  if (overlay === 'ipc') {
    return (
      <LegendShell title="Food insecurity (IPC)">
        <ul className="flex flex-col gap-0.5">
          {[1, 2, 3, 4, 5].map((phase) => (
            <li key={phase} className="flex items-center gap-2 text-2xs text-ink">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-xs"
                style={{ background: IPC_COLORS[phase] }}
              />
              Phase {phase} · {IPC_LABELS[phase]}
            </li>
          ))}
        </ul>
      </LegendShell>
    )
  }

  /*
   * The incidents overlay is the one place the heat field *is* the reading, so
   * its legend explains the heat rather than the zone ramp — and says which
   * window it covers, because that window is bounded by the row limit rather
   * than by a fixed number of days.
   */
  if (overlay === 'incidents') {
    return (
      <LegendShell title="Conflict event density">
        <span className="flex h-2 overflow-hidden rounded-full">
          {CHART.heat.map((color) => (
            <span key={color} className="flex-1" style={{ background: color }} />
          ))}
        </span>
        <span className="mt-1 flex justify-between text-2xs text-faint">
          <span>Sparse</span>
          <span>Concentrated</span>
        </span>
        <p className="mt-2 border-t border-line pt-1.5 text-2xs leading-relaxed text-faint">
          {eventWindow?.start && eventWindow.end ? (
            <>
              <span className="font-mono tabular-nums text-muted">
                {eventWindow.count.toLocaleString()}
              </span>{' '}
              events, {fmtDate(eventWindow.start)} – {fmtDate(eventWindow.end)}.{' '}
            </>
          ) : null}
          Weighted by fatalities. Includes events outside the 22 assessed zones.
        </p>
      </LegendShell>
    )
  }

  if (overlay === 'hazards') {
    return (
      <LegendShell title="Geological and climate hazards">
        <div className="grid grid-cols-2 gap-1.5 text-2xs text-ink">
          {(Object.keys(HAZARD_ICONS) as Array<keyof typeof HAZARD_ICONS>).map((type) => {
            const Icon = HAZARD_ICONS[type]
            return (
              <span key={type} className="flex items-center gap-1.5">
                <Icon size={13} strokeWidth={1.75} style={{ color: HAZARD_META[type]?.color }} aria-hidden />
                {HAZARD_META[type]?.label ?? type}
              </span>
            )
          })}
        </div>
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-eyebrow text-faint">Severity</p>
          <div className="mt-1.5 flex flex-col gap-1 text-2xs text-muted">
            {(Object.keys(HAZARD_SEVERITY_META) as Array<keyof typeof HAZARD_SEVERITY_META>).map((severity) => (
              <span key={severity} className="flex items-center gap-2">
                <span className={cx('size-2 rounded-full ring-2 ring-offset-1 ring-offset-surface', severity === 'warning' ? 'bg-err-fg ring-err-fg/30' : severity === 'watch' ? 'bg-warn-fg ring-warn-fg/30' : 'bg-accent ring-accent/30')} />
                {HAZARD_SEVERITY_META[severity].label}
              </span>
            ))}
          </div>
        </div>
      </LegendShell>
    )
  }

  const colors = overlay === 'markets' ? CHART.diverging : CHART.blues

  return (
    <LegendShell title={ramp.title}>
      {distribution ? (
        <Distribution
          values={distribution.values}
          min={distribution.min}
          max={distribution.max}
        />
      ) : null}

      <span className="flex h-2 overflow-hidden rounded-full">
        {colors.map((color) => (
          <span key={color} className="flex-1" style={{ background: color }} />
        ))}
      </span>

      {distribution ? (
        <span className="mt-1 flex justify-between font-mono text-2xs tabular-nums text-faint">
          <span>{ramp.format(distribution.min)}</span>
          <span className="text-muted" title="Median across all zones">
            {ramp.format(distribution.median)}
          </span>
          <span>{ramp.format(distribution.max)}</span>
        </span>
      ) : (
        <span className="mt-1 block text-2xs text-faint">No values this cycle</span>
      )}
    </LegendShell>
  )
}

/**
 * One tick per zone, positioned along the ramp.
 *
 * This is the difference between knowing the scale and knowing the shape.
 * Twenty-two ticks bunched at the left says "one zone is an outlier and the
 * rest are quiet" — a conclusion a bare gradient actively hides.
 */
function Distribution({
  values,
  min,
  max,
}: {
  values: number[]
  min: number
  max: number
}) {
  const span = max - min || 1
  return (
    <span className="mb-1 flex h-5 items-end gap-px">
      <span className="relative block h-full w-full">
        {values.map((value, index) => (
          <span
            key={`${value}-${index}`}
            aria-hidden
            className="absolute bottom-0 h-2.5 w-px bg-line-strong"
            style={{ left: `${((value - min) / span) * 100}%` }}
          />
        ))}
      </span>
    </span>
  )
}

function LegendShell({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    // bottom-14 clears the status strip along the bottom edge.
    <div className="pointer-events-auto absolute bottom-14 left-[17.5rem] z-map-ui w-56 rounded-bento border border-line bg-surface/92 p-2.5 shadow-panel backdrop-blur-xl xl:left-[21rem]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-eyebrow text-faint uppercase">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}
