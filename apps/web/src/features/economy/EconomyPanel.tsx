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

  const data = economyQuery.data
  if (economyQuery.isLoading) {
    return (
      <section className="rounded-bento border border-line bg-surface p-5 shadow-bento">
        <p className="text-eyebrow text-faint">Country economy</p>
        <p className="text-muted">Loading indicators...</p>
      </section>
    )
  }
  if (!data) {
    return (
      <section className="rounded-bento border border-line bg-surface p-5 shadow-bento">
        <p className="text-eyebrow text-faint">Country economy</p>
        <p className="my-2 rounded-md bg-err-bg px-3 py-2 text-sm text-err-fg">Economy indicators are unavailable.</p>
      </section>
    )
  }

  const entries = Object.entries(data.countries)
  entries.sort(([a], [b]) =>
    a === focusCountry ? -1 : b === focusCountry ? 1 : a.localeCompare(b),
  )

  return (
    <section className="rounded-bento border border-line bg-surface p-5 shadow-bento" aria-label="IGAD economy">
      <div className="mb-4">
        <div>
          <p className="text-eyebrow text-faint">IGAD economies</p>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Country indicators</h2>
        </div>
      </div>
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
      <small className="mt-2 block text-xs text-muted">{data.source}</small>
    </section>
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
        <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[0.7rem] text-muted">{iso2}</span>
      </header>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">GDP</dt>
          <dd className="font-mono text-ink">{gdp != null ? `$${gdp.toFixed(1)}B` : '—'}</dd>
        </div>
        <div>
          <dt>Growth</dt>
          <dd className={growth != null && growth < 0 ? 'font-mono text-err-fg' : 'font-mono text-ok-fg'}>
            {growth != null ? `${growth.toFixed(1)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt>Inflation</dt>
          <dd className={inflation != null && inflation > 15 ? 'font-mono text-err-fg' : 'font-mono text-ink'}>
            {inflation != null ? `${inflation.toFixed(1)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt>Population</dt>
          <dd className="font-mono text-ink">{population != null ? `${population.toFixed(1)}M` : '—'}</dd>
        </div>
      </dl>
      <Sparkline values={country.gdp_growth_pct} years={years} />
      {country.food_insecure_m != null ? (
        <small className="text-xs text-warn-fg">
          {country.food_insecure_m}M people food-insecure
        </small>
      ) : null}
      {country.note ? <small className="text-xs text-muted">{country.note}</small> : null}
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
