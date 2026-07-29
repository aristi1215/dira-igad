import { RotateCcw } from 'lucide-react'
import {
  BAND_LABELS,
  BAND_MAP_COLORS,
  CHART,
  IPC_COLORS,
  IPC_LABELS,
} from '../../lib/format'
import type { MapOverlay, OperationalBand } from '../../lib/types'
import { cx } from '../../lib/cx'

const FILTERABLE_BANDS: OperationalBand[] = ['very_high', 'high', 'elevated', 'watch', 'low']

const RAMPS: Record<string, { title: string; min: string; max: string }> = {
  displacement: { title: 'People displaced', min: '0', max: '50K+' },
  incidents: { title: 'Incidents, last 180 days', min: '0', max: '150+' },
  hazards: { title: 'Active hazard bulletins', min: '0', max: '3+' },
}

/**
 * For the pressure overlay the legend is also the filter: clicking a band
 * hides the others from both the map and the watchlist. This turns the most
 * decorative element on screen into the primary way to narrow the picture.
 *
 * The sequential overlays keep a plain ramp — a range brush would be more
 * machinery than the question warrants.
 */
export function MapLegend({
  overlay,
  bandFilter,
  onToggleBand,
  onResetBands,
}: {
  overlay: MapOverlay
  bandFilter: Set<OperationalBand> | null
  onToggleBand: (band: OperationalBand) => void
  onResetBands: () => void
}) {
  if (overlay === 'pressure') {
    return (
      <div className="pointer-events-auto absolute bottom-3 left-[17.5rem] xl:left-[21rem] z-map-ui w-52 rounded-lg border border-line bg-surface/95 p-2.5 shadow-panel backdrop-blur-sm">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
            Risk band
          </span>
          {bandFilter ? (
            <button
              type="button"
              onClick={onResetBands}
              className="inline-flex items-center gap-1 rounded-xs text-2xs text-accent transition-colors hover:text-accent-hover"
            >
              <RotateCcw size={10} strokeWidth={2} aria-hidden />
              Reset
            </button>
          ) : null}
        </div>

        <ul className="flex flex-col gap-0.5">
          {FILTERABLE_BANDS.map((band) => {
            const active = !bandFilter || bandFilter.has(band)
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
                  {BAND_LABELS[band]}
                </button>
              </li>
            )
          })}
        </ul>

        <p className="mt-1.5 border-t border-line pt-1.5 text-2xs text-faint">
          <span
            aria-hidden
            className="mr-1.5 inline-block size-2 rounded-full align-middle"
            style={{ background: BAND_MAP_COLORS.ack }}
          />
          Dot = open situation · green once acknowledged
        </p>
      </div>
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

  const ramp = RAMPS[overlay]
  return (
    <LegendShell title={ramp.title}>
      <span className="flex h-2 overflow-hidden rounded-full">
        {CHART.blues.map((color) => (
          <span key={color} className="flex-1" style={{ background: color }} />
        ))}
      </span>
      <span className="mt-1 flex justify-between text-2xs text-faint">
        <span>{ramp.min}</span>
        <span>{ramp.max}</span>
      </span>
    </LegendShell>
  )
}

function LegendShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute bottom-3 left-[17.5rem] xl:left-[21rem] z-map-ui w-52 rounded-lg border border-line bg-surface/95 p-2.5 shadow-panel backdrop-blur-sm">
      <span className="mb-1.5 block text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
        {title}
      </span>
      {children}
    </div>
  )
}
