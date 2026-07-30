import { useQuery } from '@tanstack/react-query'
import { fetchEconomy, queryKeys } from '../../lib/api'
import type { CountryEconomy } from '../../lib/types'

type EconomyPanelProps = {
  focusCountry: string | null
}

export function EconomyPanel({ focusCountry }: EconomyPanelProps) {
  const economyQuery = useQuery({
    queryKey: queryKeys.economy,
    queryFn: fetchEconomy,
    staleTime: 10 * 60 * 1000,
  })

  /*
   * Bare content, no card chrome and no heading of its own — the caller
   * supplies both. It used to render its own bordered panel with its own
   * title, inside a BentoCard that had a title too, which read as a card
   * nested in a card under two competing headings.
   */
  const data = economyQuery.data
  if (economyQuery.isLoading) {
    return <p className="text-sm text-muted">Loading indicators…</p>
  }
  if (!data) {
    return (
      <p className="rounded-md bg-err-bg px-3 py-2 text-sm text-err-fg">
        Economy indicators are unavailable.
      </p>
    )
  }

  const entries = Object.entries(data.countries)
  entries.sort(([a], [b]) =>
    a === focusCountry ? -1 : b === focusCountry ? 1 : a.localeCompare(b),
  )

  return (
    <div aria-label="IGAD economy">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {entries.map(([iso2, country]) => (
          <CountryCard
            key={iso2}
            iso2={iso2}
            country={country}
            years={data.years}
            focused={iso2 === focusCountry}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-faint">{data.source}</p>
    </div>
  )
}

function CountryCard({
  iso2,
  country,
  years,
  focused,
}: {
  iso2: string
  country: CountryEconomy
  years: number[]
  focused: boolean
}) {
  const gdp = latest(country.gdp_usd_bn)
  const growth = latest(country.gdp_growth_pct)
  const inflation = latest(country.inflation_pct)
  const population = latest(country.population_m)
  return (
    <article className={focused ? 'rounded-md border border-accent bg-accent-soft p-3' : 'rounded-md border border-line bg-surface p-3'}>
      <header className="flex items-center justify-between gap-2">
        <strong className="text-sm text-ink">{country.name}</strong>
        <span className="rounded border border-line-strong px-1.5 py-0.5 tabular-nums text-[0.7rem] text-muted">{iso2}</span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2.5 text-xs">
        <div>
          <dt className="text-faint">GDP</dt>
          <dd className="tabular-nums text-ink">{gdp != null ? `$${gdp.toFixed(1)}B` : '—'}</dd>
        </div>
        <div>
          <dt className="text-faint">Growth</dt>
          <dd
            className={
              growth != null && growth < 0
                ? 'tabular-nums text-err-fg'
                : 'tabular-nums text-ok-fg'
            }
          >
            {growth != null ? `${growth.toFixed(1)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Inflation</dt>
          <dd
            className={
              inflation != null && inflation > 15
                ? 'tabular-nums text-err-fg'
                : 'tabular-nums text-ink'
            }
          >
            {inflation != null ? `${inflation.toFixed(1)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Population</dt>
          <dd className="tabular-nums text-ink">
            {population != null ? `${population.toFixed(1)}M` : '—'}
          </dd>
        </div>
      </dl>
      <Sparkline values={country.gdp_growth_pct} years={years} />
      {/*
        Both of these were inline `<small>`s, so they ran straight into each
        other: "0.2M people food-insecurePort-services economy;…".
      */}
      {country.food_insecure_m != null ? (
        <p className="mt-2 text-xs font-medium text-warn-fg">
          {country.food_insecure_m}M people food-insecure
        </p>
      ) : null}
      {country.note ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">{country.note}</p>
      ) : null}
    </article>
  )
}

function Sparkline({
  values,
  years,
}: {
  values: (number | null)[]
  years: number[]
}) {
  const points = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null)
  if (points.length < 2) return null
  const min = Math.min(0, ...points.map((p) => p.v))
  const max = Math.max(0, ...points.map((p) => p.v))
  const range = max - min || 1
  const w = 120
  const h = 28
  const step = w / (values.length - 1)
  const path = points
    .map(
      (p, idx) =>
        `${idx === 0 ? 'M' : 'L'}${(p.i * step).toFixed(1)},${(
          h -
          ((p.v - min) / range) * h
        ).toFixed(1)}`,
    )
    .join(' ')
  const zeroY = h - ((0 - min) / range) * h
  return (
    <svg
      className="mt-3 h-7 w-full"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`GDP growth ${years[0]}–${years[years.length - 1]}`}
    >
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
      <path d={path} stroke="var(--color-accent)" strokeWidth="1.6" fill="none" />
    </svg>
  )
}

function latest(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] != null) return values[i]
  }
  return null
}
