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
      <section className="economy-panel panel-fade">
        <p className="eyebrow">Country economy</p>
        <p className="muted">Loading indicators...</p>
      </section>
    )
  }
  if (!data) {
    return (
      <section className="economy-panel panel-fade">
        <p className="eyebrow">Country economy</p>
        <p className="error-note">Economy indicators are unavailable.</p>
      </section>
    )
  }

  const entries = Object.entries(data.countries)
  entries.sort(([a], [b]) =>
    a === focusCountry ? -1 : b === focusCountry ? 1 : a.localeCompare(b),
  )

  return (
    <section className="economy-panel panel-fade" aria-label="IGAD economy">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">IGAD economies</p>
          <h2>Country indicators</h2>
        </div>
      </div>
      <div className="economy-scroll">
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
      <small className="muted source-note">{data.source}</small>
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
    <article className={focused ? 'economy-card focused' : 'economy-card'}>
      <header>
        <strong>{country.name}</strong>
        <span className="iso-chip">{iso2}</span>
      </header>
      <dl>
        <div>
          <dt>GDP</dt>
          <dd>{gdp != null ? `$${gdp.toFixed(1)}B` : '—'}</dd>
        </div>
        <div>
          <dt>Growth</dt>
          <dd className={growth != null && growth < 0 ? 'neg' : 'pos'}>
            {growth != null ? `${growth.toFixed(1)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt>Inflation</dt>
          <dd className={inflation != null && inflation > 15 ? 'neg' : ''}>
            {inflation != null ? `${inflation.toFixed(1)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt>Population</dt>
          <dd>{population != null ? `${population.toFixed(1)}M` : '—'}</dd>
        </div>
      </dl>
      <Sparkline values={country.gdp_growth_pct} years={years} />
      {country.food_insecure_m != null ? (
        <small className="food-note">
          {country.food_insecure_m}M people food-insecure
        </small>
      ) : null}
      {country.note ? <small className="muted">{country.note}</small> : null}
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
      className="sparkline"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`GDP growth ${years[0]}–${years[years.length - 1]}`}
    >
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} className="spark-zero" />
      <path d={path} className="spark-line" fill="none" />
    </svg>
  )
}

function latest(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] != null) return values[i]
  }
  return null
}
