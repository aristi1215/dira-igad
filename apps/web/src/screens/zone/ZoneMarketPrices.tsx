import { useMemo } from 'react'
import { CHART, fmtMonth, fmtNumber, titleCase } from '../../lib/format'
import { Card, EmptyState, MetricDelta, StatusChip } from '../../components/ui'
import type { MarketPriceRow } from '../../lib/types'

type Series = {
  key: string
  market: string
  commodity: string
  unit: string
  currency: string
  points: { month: string; price: number }[]
  latest: number
  pctVs3m: number | null
}

/** Terms of trade: how much staple a herder gets for one animal. */
function termsOfTrade(latest: MarketPriceRow[]): { kg: number } | null {
  const goat = latest.find((row) => row.commodity.includes('goat'))
  const maize = latest.find((row) => row.commodity.includes('maize') && row.unit === 'kg')
  return goat && maize && maize.price > 0 && goat.currency === maize.currency
    ? { kg: goat.price / maize.price }
    : null
}

/**
 * The API returns a full monthly series per market and commodity; the previous
 * screen collapsed it to a single-row table and threw the history away. Small
 * multiples show the shape of each price alongside its latest value.
 */
export function ZoneMarketPrices({ rows }: { rows: MarketPriceRow[] }) {
  const { series, tot } = useMemo(() => {
    if (rows.length === 0) {
      return { series: [] as Series[], tot: null }
    }

    const grouped = new Map<string, MarketPriceRow[]>()
    for (const row of rows) {
      const key = `${row.market_name}|${row.commodity}`
      const list = grouped.get(key) ?? []
      list.push(row)
      grouped.set(key, list)
    }

    const built: Series[] = [...grouped.entries()]
      .map(([key, group]) => {
        const ordered = [...group].sort((a, b) => a.month.localeCompare(b.month))
        const last = ordered[ordered.length - 1]
        return {
          key,
          market: last.market_name,
          commodity: last.commodity,
          unit: last.unit,
          currency: last.currency,
          points: ordered.map((row) => ({ month: row.month, price: row.price })),
          latest: last.price,
          pctVs3m: last.pct_vs_3m_avg,
        }
      })
      .sort((a, b) => `${a.market}${a.commodity}`.localeCompare(`${b.market}${b.commodity}`))

    const latestMonth = rows.reduce((max, row) => (row.month > max ? row.month : max), rows[0].month)
    const latestRows = rows.filter((row) => row.month === latestMonth)

    return { series: built, tot: termsOfTrade(latestRows) }
  }, [rows])

  return (
    <Card
      title="Market prices"
      subtitle="Monthly observations, compared against the trailing three-month average"
      actions={
        tot ? (
          <StatusChip tone={tot.kg < 40 ? 'error' : 'info'}>
            1 goat ≈ {tot.kg.toFixed(0)} kg maize
          </StatusChip>
        ) : undefined
      }
    >
      {series.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((item) => (
            <li key={item.key} className="rounded-md border border-line px-3 py-2.5">
              <p className="text-xs font-medium text-ink">{titleCase(item.commodity)}</p>
              <p className="text-2xs text-faint">{item.market}</p>

              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-md font-semibold tabular-nums text-ink">
                  {fmtNumber(item.latest)}
                  <span className="ml-1 text-2xs font-normal text-faint">
                    {item.currency}/{item.unit}
                  </span>
                </span>
                {/* Rising staple prices are bad news for the households we monitor. */}
                <MetricDelta
                  value={item.pctVs3m == null ? null : item.pctVs3m / 100}
                  goodDirection="down"
                />
              </div>

              <Sparkline points={item.points} />
              <p className="mt-1 text-2xs text-faint">
                {fmtMonth(item.points[0]?.month ?? '')} –{' '}
                {fmtMonth(item.points[item.points.length - 1]?.month ?? '')}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No price observations">
          No market data has been collected for this zone.
        </EmptyState>
      )}

      {series.length > 0 ? (
        <p className="mt-3 border-t border-line pt-2.5 text-2xs text-faint">
          A change against the three-month average matters more than the level: a sharp rise in
          staple prices squeezes households well before it shows up anywhere else.
        </p>
      ) : null}
    </Card>
  )
}

function Sparkline({ points }: { points: { month: string; price: number }[] }) {
  if (points.length < 2) {
    return <div className="mt-2 h-8" />
  }
  const values = points.map((point) => point.price)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const width = 100
  const height = 28

  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width
      const y = height - ((point.price - min) / span) * height
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const lastX = width
  const lastY = height - ((values[values.length - 1] - min) / span) * height

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-2 h-8 w-full overflow-visible"
      aria-hidden
    >
      <path d={path} fill="none" stroke={CHART.cat1} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2} fill={CHART.cat1} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
