import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cx } from '../../lib/cx'
import { fmtPct } from '../../lib/format'
import { Sparkline } from './Sparkline'
import { Eyebrow } from './Card'

/**
 * A signed change. `goodDirection` is required rather than assumed: in this
 * domain "up" is usually bad (more incidents, more displacement), so a green
 * up-arrow would actively mislead.
 */
export function MetricDelta({
  value,
  goodDirection,
  className,
}: {
  /** Fractional change, e.g. 0.12 for +12%. */
  value: number | null | undefined
  goodDirection: 'up' | 'down' | 'neutral'
  className?: string
}) {
  if (value == null || !Number.isFinite(value)) {
    return null
  }
  const rising = value > 0
  const flat = Math.abs(value) < 0.005
  const Icon = flat ? Minus : rising ? TrendingUp : TrendingDown

  const tone = flat || goodDirection === 'neutral'
    ? 'text-muted'
    : (rising && goodDirection === 'up') || (!rising && goodDirection === 'down')
      ? 'text-ok-fg'
      : 'text-err-fg'

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 text-2xs font-medium tabular-nums',
        tone,
        className,
      )}
    >
      <Icon size={12} strokeWidth={2} aria-hidden />
      {flat ? 'No change' : fmtPct(value)}
    </span>
  )
}

/**
 * A single readout.
 *
 * Label above the metric, value in mono — a number that changes
 * between cycles must not reflow the tile it sits in, and mono is also the
 * clearest signal that this is measured rather than written.
 */
export function Stat({
  label,
  value,
  detail,
  delta,
  deltaGoodDirection = 'neutral',
  accent,
  series,
  className,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  delta?: number | null
  deltaGoodDirection?: 'up' | 'down' | 'neutral'
  /** CSS color for the 3px top rule — usually a band color. */
  accent?: string
  /** Optional trend behind the number. Turns an airy tile into a dense one. */
  series?: readonly (number | null | undefined)[]
  className?: string
}) {
  return (
    <div
      className={cx(
        'relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-bento border border-line bg-surface px-4 py-4',
        'shadow-bento transition-shadow duration-200 ease-entrance hover:shadow-lg',
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: accent ?? 'var(--color-line-strong)' }}
      />
      <Eyebrow>{label}</Eyebrow>
      <span className="flex items-end justify-between gap-2">
        <span className="text-metric font-semibold tabular-nums text-ink">{value}</span>
        {series ? (
          <Sparkline
            values={series}
            width={54}
            height={20}
            color={accent ?? 'var(--color-accent)'}
            className="mb-0.5 shrink-0"
          />
        ) : null}
      </span>
      {delta != null || detail ? (
        <span className="flex items-center gap-2 text-xs text-faint">
          {delta != null ? <MetricDelta value={delta} goodDirection={deltaGoodDirection} /> : null}
          {detail}
        </span>
      ) : null}
    </div>
  )
}

/** Back-compatible alias — same element, original prop names. */
export function StatTile({
  label,
  value,
  detail,
  accent,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  accent?: string
}) {
  return <Stat label={label} value={value} detail={detail} accent={accent} />
}

/** Responsive container for a row of Stats. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        // 13rem, not 10.5rem: with only three or four tiles the old minimum
        // let each one sprawl to ~390px around a single number.
        'grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3',
        className,
      )}
    >
      {children}
    </div>
  )
}
