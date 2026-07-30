import { CalendarDays, CalendarRange } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { forecastWindowParts } from '../../lib/format'

/**
 * When something happened, or when it applies to.
 *
 * Everything in this product is an assertion about a *period* — a dekad, a
 * forecast window, the moment a record became knowable — so the date is not
 * metadata alongside the reading, it is half of the reading. These used to be
 * `text-muted` captions at the size of a footnote; they are set in the ink
 * colour at the weight of a value now.
 */
export function DateStamp({
  children,
  className,
  title,
  /** `strong` for the date a card is *about*; `quiet` for incidental stamps. */
  tone = 'default',
  icon = true,
}: {
  children: ReactNode
  className?: string
  title?: string
  tone?: 'default' | 'strong' | 'quiet'
  icon?: boolean
}) {
  const TONE = {
    default: 'text-xs font-semibold text-ink',
    strong: 'text-sm font-semibold text-ink',
    quiet: 'text-xs font-medium text-muted',
  } as const

  return (
    <span
      className={cx('inline-flex items-center gap-1.5 tabular-nums', TONE[tone], className)}
      title={title}
    >
      {icon ? (
        <CalendarDays
          size={tone === 'strong' ? 15 : 13}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-faint"
        />
      ) : null}
      <span>{children}</span>
    </span>
  )
}

/**
 * The period a forecast covers, at display size.
 *
 * This is the single most consequential date in the product — it is what an
 * operator is being asked to act on — and it was a `text-xs` caption reading
 * "Forecast window: 2026-03-20 – 2026-04-19" in raw ISO. The dates lead now,
 * with the duration demoted beneath them.
 */
export function ForecastWindow({
  start,
  end,
  horizonDekads,
  label = 'Forecast window',
  size = 'md',
  className,
}: {
  start: string | null | undefined
  end: string | null | undefined
  horizonDekads?: number | null
  label?: string
  /** `lg` for the one on a situation's verdict; `sm` inside dense cards. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const { range, detail } = forecastWindowParts(start, end, horizonDekads)

  const RANGE_SIZE = {
    sm: 'text-md',
    md: 'text-lg',
    lg: 'text-xl',
  } as const

  return (
    <div
      className={cx(
        'inline-flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-2 px-3 py-2',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-eyebrow text-faint uppercase">
        <CalendarRange size={12} strokeWidth={2} aria-hidden className="shrink-0" />
        {label}
      </span>
      <span
        className={cx(
          'leading-tight font-semibold tracking-[-0.01em] tabular-nums text-ink',
          RANGE_SIZE[size],
        )}
      >
        {range}
      </span>
      {detail ? <span className="text-2xs tabular-nums text-faint">{detail}</span> : null}
    </div>
  )
}
