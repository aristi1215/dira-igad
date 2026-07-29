import { cx } from '../../lib/cx'

/**
 * A bare trend mark — no axes, no grid, no labels.
 *
 * Used inline inside stat tiles, table cells and map badges, where the question
 * is only "which way, and how sharply". Anything that needs a readable value
 * belongs in `TimeSeriesChart` instead.
 *
 * Deliberately not a recharts component: recharts is lazy-loaded with the
 * chart-heavy screens, and these appear on the map route, which must not pay
 * for it.
 */
export function Sparkline({
  values,
  width = 48,
  height = 16,
  color = 'currentColor',
  /** Draws a filled area under the line. Off inside dense tables. */
  area = true,
  /** Marks the most recent point. Reads as "you are here". */
  cap = true,
  className,
}: {
  values: readonly (number | null | undefined)[]
  width?: number
  height?: number
  color?: string
  area?: boolean
  cap?: boolean
  className?: string
}) {
  const points = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  // One point is not a trend, and a flat two-point line is noise.
  if (points.length < 2) {
    return null
  }

  const min = Math.min(...points)
  const max = Math.max(...points)
  // A flat series would divide by zero; draw it down the middle instead.
  const span = max - min || 1
  const padding = 1.5
  const usableHeight = height - padding * 2
  const step = width / (points.length - 1)

  const coords = points.map((value, index) => {
    const x = index * step
    const y = padding + (1 - (value - min) / span) * usableHeight
    return [x, y] as const
  })

  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const last = coords[coords.length - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx('overflow-visible', className)}
      style={{ color }}
      aria-hidden
      focusable="false"
    >
      {area ? (
        <polygon
          points={`0,${height} ${line} ${width},${height}`}
          fill="currentColor"
          opacity={0.12}
        />
      ) : null}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {cap ? <circle cx={last[0]} cy={last[1]} r={1.75} fill="currentColor" /> : null}
    </svg>
  )
}
