import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAnalytics, queryKeys } from '../lib/api'
import {
  BAND_ORDER,
  CHART,
  COUNTRY_NAMES,
  fmtCompact,
  fmtMonth,
} from '../lib/format'
import {
  BentoCard,
  BentoGrid,
  ErrorNote,
  Eyebrow,
  PageHeader,
  Screen,
  SkeletonCard,
} from '../components/ui'
import { BandDistributionBar, type BandCounts } from '../components/BandDistributionBar'
import { HBarList, HeatStrip, TimeSeriesChart } from '../components/charts'
import { AskAboutButton } from '../features/advisor'
import { EconomyPanel } from '../features/economy'
import type { OperationalBand } from '../lib/types'

export function AnalyticsScreen() {
  const analyticsQuery = useQuery({
    queryKey: queryKeys.analytics,
    queryFn: fetchAnalytics,
  })

  const data = analyticsQuery.data

  const bandCounts = useMemo<BandCounts>(() => {
    const counts: BandCounts = new Map()
    for (const row of data?.band_distribution ?? []) {
      counts.set(row.band as OperationalBand | 'none', row.zones)
    }
    return counts
  }, [data?.band_distribution])

  const rainfall = useMemo(() => {
    const rows = data?.climate_by_cluster ?? []
    const clusters = [...new Set(rows.map((row) => row.cluster_id))].sort()
    const dekads = [...new Set(rows.map((row) => row.dekad_start))].sort()
    const lookup = new Map(
      rows.map((row) => [`${row.cluster_id}|${row.dekad_start}`, row.rain_mm]),
    )
    const maxValue = Math.max(1, ...rows.map((row) => row.rain_mm ?? 0))
    return { clusters, dekads, lookup, maxValue }
  }, [data?.climate_by_cluster])

  /** Month-over-month change in incidents — the only real trend in the data. */
  const incidentTrend = useMemo(() => {
    const rows = data?.incidents_monthly ?? []
    if (rows.length < 2) return null
    const latest = rows[rows.length - 1]
    const previous = rows[rows.length - 2]
    if (!previous.events) return null
    return {
      latest: latest.events,
      delta: (latest.events - previous.events) / previous.events,
      month: latest.month,
    }
  }, [data?.incidents_monthly])

  const severeZones = BAND_ORDER.filter(
    (band) => band === 'high' || band === 'very_high',
  ).reduce((sum, band) => sum + (bandCounts.get(band) ?? 0), 0)

  const ackRate =
    data && data.delivery_stats.total > 0
      ? Math.round((data.delivery_stats.acked / data.delivery_stats.total) * 100)
      : null

  return (
    <Screen width="wide">
      <PageHeader
        eyebrow="Regional analytics"
        title="The region over time"
        description="Cross-zone trends: conflict, climate, food security, displacement, field reporting and dispatch performance."
      />

      {analyticsQuery.isError ? <ErrorNote error={analyticsQuery.error} className="mb-4" /> : null}
      {analyticsQuery.isLoading ? <SkeletonCard /> : null}

      {data ? (
        <>
          <BentoGrid className="mb-5">
            <BentoCard
              span={4}
              rowSpan={2}
              eyebrow="Regional picture"
              title="Band distribution"
              subtitle="Zones by operational band this cycle"
            >
              <div className="mb-4 border-b border-line pb-3">
                <Eyebrow className="mb-1.5 block">Zones by risk band, this cycle</Eyebrow>
                <BandDistributionBar counts={bandCounts} />
              </div>
              <HBarList
                items={data.food_security_by_country.map((row) => ({
                  key: row.country_iso2,
                  label: COUNTRY_NAMES[row.country_iso2] ?? row.country_iso2,
                  value: row.pop_phase3_plus,
                }))}
                formatter={fmtCompact}
              />
            </BentoCard>

            <BentoCard span={2} tone="inverse" eyebrow="Priority signal" title="Zones at risk">
              <p className="font-mono text-4xl font-semibold tabular-nums">{severeZones}</p>
              <p className="mt-2 text-sm text-white/70">high or very high this cycle</p>
              <p className="mt-5 text-xs text-white/60">
                {data.delivery_stats.needs_review > 0
                  ? `${data.delivery_stats.needs_review} deliveries need review`
                  : 'No delivery exceptions'}
              </p>
            </BentoCard>

            <BentoCard span={2} eyebrow="Food security" title="People in P3+">
              <HBarList
                items={data.food_security_by_country.slice(0, 4).map((row) => ({
                  key: row.country_iso2,
                  label: COUNTRY_NAMES[row.country_iso2] ?? row.country_iso2,
                  value: row.pop_phase3_plus,
                }))}
                formatter={fmtCompact}
              />
            </BentoCard>

            <BentoCard span={4} rowSpan={2} eyebrow="Conflict" title="Incidents by month" subtitle="Region-wide monthly totals across monitored zones" actions={<AskAboutButton question="What is driving the regional trend in conflict incidents over the last year?" />}>
              <TimeSeriesChart
                data={data.incidents_monthly as unknown as Record<string, unknown>[]}
                xKey="month"
                xFormatter={fmtMonth}
                height={300}
                series={[
                  { key: 'events', label: 'Incidents', kind: 'bar', color: CHART.cat1 },
                  { key: 'fatalities', label: 'Fatalities', kind: 'line', color: CHART.cat2 },
                ]}
              />
              <p className="mt-3 text-xs text-faint">
                Latest month: <span className="font-mono text-ink">{incidentTrend?.latest ?? '—'}</span>
                {incidentTrend ? ` · ${fmtMonth(incidentTrend.month)}` : ''}
              </p>
            </BentoCard>

            <BentoCard span={2} rowSpan={2} eyebrow="Movement" title="Displacement">
              <HBarList
                items={data.displacement_by_country.map((row) => ({
                  key: row.country_iso2,
                  label: COUNTRY_NAMES[row.country_iso2] ?? row.country_iso2,
                  value: row.idps,
                }))}
                formatter={fmtCompact}
                color={CHART.cat4}
              />
            </BentoCard>

            <BentoCard span={2} eyebrow="Field evidence" title="Report funnel">
              <p className="font-mono text-3xl font-semibold tabular-nums text-ink">{data.field_report_stats.verified}</p>
              <p className="mt-1 text-xs text-faint">verified reports</p>
              <p className="mt-4 text-xs text-muted">{data.field_report_stats.unverified} awaiting verification</p>
            </BentoCard>

            <BentoCard span={2} eyebrow="Dispatch" title="Delivery health">
              <p className="font-mono text-3xl font-semibold tabular-nums text-ink">{ackRate != null ? `${ackRate}%` : '—'}</p>
              <p className="mt-1 text-xs text-faint">acknowledged</p>
              <p className="mt-4 text-xs text-muted">{data.delivery_stats.total} calls placed</p>
            </BentoCard>

            <BentoCard span={2} eyebrow="Climate" title="Rainfall by cluster" subtitle="Millimetres per 10-day period">
              {rainfall.clusters.length > 0 ? (
                <HeatStrip
                  rows={rainfall.clusters}
                  columns={rainfall.dekads}
                  valueAt={(row, column) => rainfall.lookup.get(`${row}|${column}`) ?? null}
                  maxValue={rainfall.maxValue}
                  columnFormatter={fmtMonth}
                  title="Rainfall by cluster and 10-day period"
                />
              ) : null}
              <p className="mt-3 flex items-center gap-2 text-2xs text-faint">
                Drier
                <span className="flex h-1.5 w-24 overflow-hidden rounded-full">
                  {CHART.blues.map((color) => (
                    <span key={color} className="flex-1" style={{ background: color }} />
                  ))}
                </span>
                Wetter
              </p>
            </BentoCard>
          </BentoGrid>
        </>
      ) : null}

      <BentoCard
        span={6}
        title="Country economies"
        subtitle="World Bank indicators for the seven IGAD countries"
      >
        <EconomyPanel focusCountry={null} />
      </BentoCard>
    </Screen>
  )
}
