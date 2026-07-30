/* Chart primitives — mark specs per the dataviz method:
   bars ≤24px with 4px rounded data-ends (square baseline), 2px lines,
   hairline solid gridlines, muted axis text, tooltips on hover, and color
   assigned by job (sequential single hue by default; categorical slots in
   fixed order; band/status colors reserved for band semantics). */

import type { ReactNode } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART, fmtCompact } from '../lib/format'
import { useChartChrome } from '../lib/chartChrome'

/*
 * The chart *chrome* is read per render from `useChartChrome`, never from a
 * module constant. As a constant it could not follow the theme, so a dark
 * dashboard drew near-white gridlines and bright empty heatmap cells. The
 * data hues in `CHART` stay theme-invariant, exactly like the band and IPC
 * palettes — those carry meaning, this does not.
 */

type SeriesSpec = {
  key: string
  label: string
  color?: string
  kind: 'bar' | 'line'
}

export function TimeSeriesChart({
  data,
  xKey,
  series,
  height = 220,
  xFormatter,
  yFormatter = fmtCompact,
}: {
  data: Record<string, unknown>[]
  xKey: string
  series: SeriesSpec[]
  height?: number
  xFormatter?: (value: string) => string
  yFormatter?: (value: number) => string
}) {
  const chrome = useChartChrome()
  const axisTick = { fill: chrome.axisInk, fontSize: 11 }
  const palette = [CHART.cat1, CHART.cat2, CHART.cat3, CHART.cat4]
  const multi = series.length > 1
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="25%">
        <CartesianGrid stroke={chrome.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: chrome.grid }}
          tickFormatter={xFormatter}
          minTickGap={24}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => yFormatter(v)}
        />
        <Tooltip content={<ChartTooltip xFormatter={xFormatter} yFormatter={yFormatter} />} />
        {multi ? (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: chrome.legendInk }}
          />
        ) : null}
        {series.map((s, i) =>
          s.kind === 'bar' ? (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color ?? palette[i % palette.length]}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          ) : (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type="monotone"
              stroke={s.color ?? palette[i % palette.length]}
              strokeWidth={2}
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: chrome.markStroke }}
              connectNulls
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
  xFormatter,
  yFormatter = fmtCompact,
}: {
  active?: boolean
  payload?: { name?: string; value?: number | string; color?: string }[]
  label?: string
  xFormatter?: (value: string) => string
  yFormatter?: (value: number) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-md border border-line-strong bg-surface px-2.5 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">
        {xFormatter && label != null ? xFormatter(String(label)) : label}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} className="my-0.5 flex items-center gap-1.5 text-muted">
          <span className="inline-block size-2 rounded-full" style={{ background: entry.color }} />
          {entry.name}:{' '}
          <strong>
            {typeof entry.value === 'number' ? yFormatter(entry.value) : entry.value}
          </strong>
        </p>
      ))}
    </div>
  )
}

/** Horizontal comparison bars with direct value labels at the tip (one hue —
    nominal categories carry identity in their row labels, not in color). */
export function HBarList({
  items,
  color = CHART.cat1,
  formatter = fmtCompact,
  rightSlot,
}: {
  items: { label: string; value: number | null; key?: string }[]
  color?: string
  formatter?: (value: number) => string
  rightSlot?: (item: { label: string; value: number | null; key?: string }) => ReactNode
}) {
  const max = Math.max(1, ...items.map((i) => i.value ?? 0))
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.key ?? item.label} className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto_auto] items-center gap-2.5 text-sm">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-muted">{item.label}</span>
          <span className="h-3.5 overflow-hidden rounded-r bg-surface-2">
            <span
              className="block h-full rounded-r"
              style={{ width: `${((item.value ?? 0) / max) * 100}%`, background: color }}
            />
          </span>
          <span className="min-w-12 text-right font-semibold tabular-nums">
            {item.value == null ? '—' : formatter(item.value)}
          </span>
          {rightSlot ? rightSlot(item) : null}
        </div>
      ))}
    </div>
  )
}

/** Heat strip: rows × ordered columns, sequential single-hue fill. */
export function HeatStrip({
  rows,
  columns,
  valueAt,
  maxValue,
  columnFormatter,
  rowFormatter,
  title,
}: {
  rows: string[]
  columns: string[]
  valueAt: (row: string, column: string) => number | null
  maxValue: number
  columnFormatter?: (value: string) => string
  /** Row keys double as labels; pass this when the key is an id. */
  rowFormatter?: (value: string) => string
  title?: string
}) {
  const chrome = useChartChrome()
  const ramp = CHART.blues
  const cellColor = (value: number | null) => {
    // "No observation" is the surface showing through, not a fixed light grey.
    if (value == null) return chrome.nullFill
    const t = Math.max(0, Math.min(1, value / maxValue))
    // More-is-darker on the blue ramp.
    return ramp[Math.min(ramp.length - 1, Math.max(1, Math.round(t * (ramp.length - 1))))]
  }
  return (
    <div className="grid gap-[3px] text-xs" role="table" aria-label={title}>
      {rows.map((row) => (
        <div key={row} className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-2.5" role="row">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-muted">
            {rowFormatter ? rowFormatter(row) : row}
          </span>
          <span className="flex gap-0.5">
            {columns.map((col) => {
              const value = valueAt(row, col)
              return (
                <span
                  key={col}
                  // rounded-[2px], not rounded-sm: a 6px radius on a ~10px-wide
                  // cell turned the grid into a field of dots.
                  className="h-4 min-w-0 flex-1 rounded-[2px]"
                  style={{ background: cellColor(value) }}
                  title={`${row} · ${columnFormatter ? columnFormatter(col) : col}: ${
                    value == null ? 'no data' : `${value.toFixed(1)} mm`
                  }`}
                />
              )
            })}
          </span>
        </div>
      ))}
      <div className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-2.5" role="row">
        <span />
        <span className="flex justify-between text-[0.72rem] text-faint">
          <span>{columnFormatter ? columnFormatter(columns[0]) : columns[0]}</span>
          <span>
            {columnFormatter
              ? columnFormatter(columns[columns.length - 1])
              : columns[columns.length - 1]}
          </span>
        </span>
      </div>
    </div>
  )
}
