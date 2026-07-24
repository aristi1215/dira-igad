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

const AXIS_TICK = { fill: CHART.axisInk, fontSize: 11 }

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
  const palette = [CHART.cat1, CHART.cat2, CHART.cat3, CHART.cat4]
  const multi = series.length > 1
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="25%">
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: CHART.grid }}
          tickFormatter={xFormatter}
          minTickGap={24}
        />
        <YAxis
          tick={AXIS_TICK}
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
            wrapperStyle={{ fontSize: 12, color: CHART.axisInk }}
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
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
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
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        {xFormatter && label != null ? xFormatter(String(label)) : label}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: entry.color }} />
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
    <div className="hbar-list">
      {items.map((item) => (
        <div key={item.key ?? item.label} className="hbar-row">
          <span className="hbar-label">{item.label}</span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{ width: `${((item.value ?? 0) / max) * 100}%`, background: color }}
            />
          </span>
          <span className="hbar-value">
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
  title,
}: {
  rows: string[]
  columns: string[]
  valueAt: (row: string, column: string) => number | null
  maxValue: number
  columnFormatter?: (value: string) => string
  title?: string
}) {
  const ramp = CHART.blues
  const cellColor = (value: number | null) => {
    if (value == null) return '#f4f4f4'
    const t = Math.max(0, Math.min(1, value / maxValue))
    // More-is-darker on the blue ramp.
    return ramp[Math.min(ramp.length - 1, Math.max(1, Math.round(t * (ramp.length - 1))))]
  }
  return (
    <div className="heat-strip" role="table" aria-label={title}>
      {rows.map((row) => (
        <div key={row} className="heat-row" role="row">
          <span className="heat-row-label">{row}</span>
          <span className="heat-cells">
            {columns.map((col) => {
              const value = valueAt(row, col)
              return (
                <span
                  key={col}
                  className="heat-cell"
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
      <div className="heat-row heat-axis" role="row">
        <span className="heat-row-label" />
        <span className="heat-cells heat-axis-labels">
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
