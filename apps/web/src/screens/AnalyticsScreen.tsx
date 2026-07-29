import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAnalytics, queryKeys } from '../lib/api'
import {
  BAND_MAP_COLORS,
  BAND_ORDER,
  CHART,
  COUNTRY_NAMES,
  fmtCompact,
  fmtMonth,
} from '../lib/format'
import {
  Card,
  ErrorNote,
  PageHeader,
  Screen,
  SkeletonCard,
  Stat,
  StatRow,
} from '../components/ui'
import { BandDistributionBar, type BandCounts } from '../components/BandDistributionBar'
import { HBarList, HeatStrip, TimeSeriesChart } from '../components/charts'
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
    <Screen>
      <PageHeader
        eyebrow="Regional analytics"
        title="The region over time"
        description="Cross-zone trends for the whole monitoring area: conflict, climate, food security, displacement, field reporting and how dispatch is performing."
      />

      {analyticsQuery.isError ? <ErrorNote error={analyticsQuery.error} className="mb-4" /> : null}
      {analyticsQuery.isLoading ? <SkeletonCard /> : null}

      {data ? (
        <>
          <StatRow className="mb-5">
            <Stat
              label="Zones needing attention"
              value={severeZones}
              detail="High or very high this cycle"
              accent={BAND_MAP_COLORS.high}
            />
            <Stat
              label="Incidents, latest month"
              value={incidentTrend ? incidentTrend.latest : '—'}
              delta={incidentTrend?.delta ?? null}
              deltaGoodDirection="down"
              detail={
                incidentTrend ? `${fmtMonth(incidentTrend.month)} vs the month before` : undefined
              }
            />
            <Stat
              label="Verified field reports"
              value={data.field_report_stats.verified}
              detail={`${data.field_report_stats.unverified} awaiting verification`}
              accent={BAND_MAP_COLORS.ack}
            />
            <Stat
              label="Alerts acknowledged"
              value={ackRate != null ? `${ackRate}%` : '—'}
              detail={
                data.delivery_stats.needs_review > 0
                  ? `${data.delivery_stats.needs_review} deliveries need review`
                  : `${data.delivery_stats.total} calls placed`
              }
              accent={BAND_MAP_COLORS.low}
            />
          </StatRow>

          {/* The only true time series in the product leads, full width. */}
          <Card
            title="Conflict incidents and fatalities"
            subtitle="Region-wide monthly totals across all monitored zones"
            className="mb-5"
          >
            <TimeSeriesChart
              data={data.incidents_monthly as unknown as Record<string, unknown>[]}
              xKey="month"
              xFormatter={fmtMonth}
              height={260}
              series={[
                { key: 'events', label: 'Incidents', kind: 'bar', color: CHART.cat1 },
                { key: 'fatalities', label: 'Fatalities', kind: 'line', color: CHART.cat2 },
              ]}
            />
          </Card>

          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card
              title="Zones by risk band"
              subtitle="How the 22 monitored zones sit in the latest cycle"
            >
              <BandDistributionBar counts={bandCounts} />
            </Card>

            <Card
              title="People in food crisis"
              subtitle="Population in IPC Phase 3 or worse, by country"
            >
              <HBarList
                items={data.food_security_by_country.map((row) => ({
                  key: row.country_iso2,
                  label: COUNTRY_NAMES[row.country_iso2] ?? row.country_iso2,
                  value: row.pop_phase3_plus,
                }))}
                formatter={fmtCompact}
              />
            </Card>

            <Card
              title="Internally displaced people"
              subtitle="Latest snapshots summed by country"
            >
              <HBarList
                items={data.displacement_by_country.map((row) => ({
                  key: row.country_iso2,
                  label: COUNTRY_NAMES[row.country_iso2] ?? row.country_iso2,
                  value: row.idps,
                }))}
                formatter={fmtCompact}
                color={CHART.cat4}
              />
            </Card>

            <Card
              title="Rainfall by cluster"
              subtitle="Millimetres per 10-day period — darker is wetter, pale strips are dry spells"
            >
              {rainfall.clusters.length > 0 ? (
                <HeatStrip
                  rows={rainfall.clusters}
                  columns={rainfall.dekads}
                  valueAt={(row, column) => rainfall.lookup.get(`${row}|${column}`) ?? null}
                  maxValue={rainfall.maxValue}
                  columnFormatter={fmtMonth}
                  title="Rainfall by cluster and dekad"
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
            </Card>
          </div>
        </>
      ) : null}

      <Card
        title="Country economies"
        subtitle="World Bank indicators for the seven IGAD countries"
      >
        <EconomyPanel focusCountry={null} />
      </Card>
    </Screen>
  )
}
