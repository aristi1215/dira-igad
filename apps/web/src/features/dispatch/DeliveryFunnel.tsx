import type { Delivery, DeliveryStatus } from '../../lib/types'
import { cx } from '../../lib/cx'
import { BOARD_COLUMNS } from './constants'

/**
 * The pipeline as a single proportional bar.
 *
 * A board of columns answers "which calls are where"; it does not answer "is
 * dispatch working". This does, in one line: what share of calls landed, what
 * share was acknowledged, and what is stuck — which is the question anyone
 * opening this screen mid-incident is actually asking.
 *
 * It sits in the page header rather than under the board, where four large
 * stat tiles used to push the actual work below the fold.
 */
export function DeliveryFunnel({
  byStatus,
  total,
  acked,
  className,
}: {
  byStatus: Map<DeliveryStatus, Delivery[]>
  total: number
  acked: number
  className?: string
}) {
  if (total === 0) return null

  const segments = BOARD_COLUMNS.map((column) => ({
    ...column,
    count: byStatus.get(column.status)?.length ?? 0,
  })).filter((segment) => segment.count > 0)

  const delivered = byStatus.get('delivered')?.length ?? 0
  const rate = (value: number) => `${Math.round((value / total) * 100)}%`

  return (
    <div className={cx('flex flex-wrap items-center gap-x-5 gap-y-2', className)}>
      <span className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums text-ink">{rate(delivered)}</span>
        <span className="text-eyebrow text-faint uppercase">delivered</span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums text-ink">{rate(acked)}</span>
        <span className="text-eyebrow text-faint uppercase">acknowledged</span>
      </span>

      <span className="flex min-w-[14rem] flex-1 flex-col gap-1">
        <span className="flex h-2.5 overflow-hidden rounded-full">
          {segments.map((segment) => (
            <span
              key={segment.status}
              title={`${segment.count} ${segment.label.toLowerCase()}`}
              className={cx(
                'h-full transition-[flex-grow] duration-[300ms] ease-standard',
                segment.bar,
              )}
              style={{ flexGrow: segment.count }}
            />
          ))}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs tabular-nums text-faint">
          {segments.map((segment) => (
            <span key={segment.status} className="flex items-center gap-1">
              <span aria-hidden className={cx('size-1.5 rounded-full', segment.bar)} />
              {segment.count} {segment.label.toLowerCase()}
            </span>
          ))}
        </span>
      </span>
    </div>
  )
}
