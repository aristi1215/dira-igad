import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cx } from '../../lib/cx'
import { fmtPct } from '../../lib/format'

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
    <span className={cx('inline-flex items-center gap-1 text-2xs font-medium tabular-nums', tone, className)}>
      <Icon size={12} strokeWidth={2} aria-hidden />
      {flat ? 'No change' : fmtPct(value)}
    </span>
  )
}

export function Stat({
  label,
  value,
  detail,
  delta,
  deltaGoodDirection = 'neutral',
  accent,
  className,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  delta?: number | null
  deltaGoodDirection?: 'up' | 'down' | 'neutral'
  /** CSS color for the 3px top rule — usually a band color. */
  accent?: string
  className?: string
}) {
  return (
    <div
      className={cx(
        'flex flex-col gap-1 rounded-lg border border-line border-t-[3px] bg-surface px-3.5 py-3',
        'transition-shadow duration-[180ms] ease-standard hover:shadow-sm',
        className,
      )}
      style={{ borderTopColor: accent ?? 'var(--color-line-strong)' }}
    >
      <span className="text-2xs font-medium tracking-[0.04em] text-muted uppercase">{label}</span>
      <span className="text-2xl leading-none font-semibold tabular-nums text-ink">{value}</span>
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
        'grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-3',
        className,
      )}
    >
      {children}
    </div>
  )
}
