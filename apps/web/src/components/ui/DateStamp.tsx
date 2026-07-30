import { CalendarDays } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

export function DateStamp({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted',
        className,
      )}
      title={title}
    >
      <CalendarDays size={13} strokeWidth={1.75} aria-hidden />
      <span>{children}</span>
    </span>
  )
}
