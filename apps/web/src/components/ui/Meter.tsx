import { motion } from 'motion/react'
import { cx } from '../../lib/cx'
import { T } from '../../lib/motion'

export function Meter({
  value,
  color = 'var(--color-accent)',
  track = 'var(--color-accent-ring)',
  ticks,
  height = 'md',
  animate = true,
  className,
  label,
}: {
  value: number | null | undefined
  color?: string
  track?: string
  /** Pass BAND_TICKS from lib/explain.ts to mark the band boundaries. */
  ticks?: number[]
  height?: 'sm' | 'md' | 'lg'
  animate?: boolean
  className?: string
  label?: string
}) {
  const v = Math.max(0, Math.min(1, value ?? 0))
  const heightClass = height === 'sm' ? 'h-1' : height === 'lg' ? 'h-2.5' : 'h-1.5'

  return (
    <span
      role={label ? 'meter' : undefined}
      aria-label={label}
      aria-valuenow={label ? Math.round(v * 100) : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      className={cx('relative block w-full overflow-hidden rounded-full', heightClass, className)}
      style={{ background: track }}
    >
      <motion.span
        className="absolute inset-y-0 left-0 block rounded-full"
        style={{ background: color }}
        initial={animate ? { width: 0 } : false}
        animate={{ width: `${v * 100}%` }}
        transition={T.value}
      />
      {ticks?.map((tick) => (
        <span
          key={tick}
          aria-hidden
          className="absolute inset-y-0 w-px bg-surface/70 mix-blend-overlay"
          style={{ left: `${tick * 100}%` }}
        />
      ))}
    </span>
  )
}

/**
 * Back-compatible alias kept so screens can migrate one at a time.
 * Superseded by Meter; both render the same element.
 */
export function ScoreMeter({
  value,
  color = '#0f62fe',
  track = '#d0e2ff',
}: {
  value: number | null | undefined
  color?: string
  track?: string
}) {
  return <Meter value={value} color={color} track={track} height="sm" animate={false} />
}
