import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../../lib/cx'
import { T } from '../../lib/motion'

export type TabItem<T extends string> = {
  id: T
  label: string
  icon?: LucideIcon
  /** Rendered as a subdued count after the label. */
  count?: number
}

/**
 * Segmented control with a sliding indicator. The indicator is a single
 * shared `layoutId` element, so switching tabs reads as one continuous
 * movement rather than two independent fades.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  layoutId,
  className,
  ariaLabel,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  size?: 'sm' | 'md'
  /** Must be unique per mounted Tabs instance. */
  layoutId: string
  className?: string
  ariaLabel?: string
}) {
  const iconSize = size === 'sm' ? 13 : 15
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx(
        'inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 shadow-sm',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cx(
              'relative inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
              'transition-colors duration-[120ms] ease-standard',
              size === 'sm' ? 'h-6.5 px-2 text-2xs' : 'h-7.5 px-2.5 text-xs',
              active ? 'text-white' : 'text-muted hover:bg-surface-3 hover:text-ink',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={T.panel}
                className="absolute inset-0 rounded-full bg-accent"
                aria-hidden
              />
            ) : null}
            {Icon ? (
              <Icon size={iconSize} strokeWidth={1.75} aria-hidden className="relative z-1" />
            ) : null}
            <span className="relative z-1">{item.label}</span>
            {item.count != null ? (
              <span
                className={cx(
                  'relative z-1 tabular-nums',
                  // On the accent pill. `text-accent-deep` here measured 2.25:1.
                  active ? 'text-white/75' : 'text-faint',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
