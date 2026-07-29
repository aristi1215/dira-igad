import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

/** A keycap — used by the dispatch keypad legend and the tour's shortcut hints. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded-xs border border-line-strong border-b-2 bg-surface-2 px-1.5 py-0.5',
        'font-mono text-2xs font-medium text-ink',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
