import { BAND_LABELS, BAND_MAP_COLORS, BAND_ORDER } from '../lib/format'
import type { OperationalBand } from '../lib/types'
import { cx } from '../lib/cx'

export type BandCounts = Map<OperationalBand | 'none', number>

/**
 * Proportional stacked bar of zones per band. When `onSelect` is supplied it
 * doubles as the filter control: the picture of the region and the way you
 * narrow it are the same object, so there is nothing extra to learn.
 */
export function BandDistributionBar({
  counts,
  selected,
  onSelect,
  className,
}: {
  counts: BandCounts
  selected?: OperationalBand | 'none' | null
  onSelect?: (band: OperationalBand | 'none' | null) => void
  className?: string
}) {
  const bands = BAND_ORDER.filter((band) => (counts.get(band) ?? 0) > 0)
  const total = bands.reduce((sum, band) => sum + (counts.get(band) ?? 0), 0)
  if (total === 0) {
    return null
  }

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div className="flex h-7 gap-px overflow-hidden rounded-sm" role="img" aria-label="Zones by risk band">
        {bands.map((band) => {
          const count = counts.get(band) ?? 0
          const isSelected = selected === band
          const dimmed = selected != null && !isSelected
          const label = `${BAND_LABELS[band]}: ${count} zone${count === 1 ? '' : 's'}`
          const content = (
            <>
              <span className="sr-only">{label}</span>
              <span aria-hidden className="text-2xs font-semibold text-white drop-shadow-sm">
                {count}
              </span>
            </>
          )
          const style = {
            flexGrow: count,
            flexBasis: 0,
            background: BAND_MAP_COLORS[band],
            color: band === 'watch' ? 'var(--color-ink)' : undefined,
          }

          return onSelect ? (
            <button
              key={band}
              type="button"
              title={label}
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : band)}
              style={style}
              className={cx(
                'flex items-center justify-center transition-opacity duration-[160ms] ease-standard',
                'hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ink',
                dimmed && 'opacity-30',
              )}
            >
              {content}
            </button>
          ) : (
            <span
              key={band}
              title={label}
              style={style}
              className="flex items-center justify-center"
            >
              {content}
            </span>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {bands.map((band) => (
          <span key={band} className="inline-flex items-center gap-1.5 text-2xs text-muted">
            <span
              aria-hidden
              className="size-2 rounded-xs"
              style={{ background: BAND_MAP_COLORS[band] }}
            />
            {BAND_LABELS[band]}
          </span>
        ))}
      </div>
    </div>
  )
}
