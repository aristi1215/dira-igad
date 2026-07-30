import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAnalytics, queryKeys } from '../lib/api'
import {
  BAND_LABELS,
  BAND_ORDER,
  CHART,
  COUNTRY_NAMES,
  fmtCompact,
  fmtDate,
  fmtMonth,
  titleCase,
} from '../lib/format'
import {
  BandDot,
  BentoCard,
  BentoGrid,
  DateStamp,
  ErrorNote,
  IpcChip,
  MetricDelta,
  PageHeader,
  Screen,
  SkeletonCard,
} from '../components/ui'
import { BandDistributionBar, type BandCounts } from '../components/BandDistributionBar'
import { HBarList, HeatStrip, TimeSeriesChart } from '../components/charts'
import { AskAboutButton } from '../features/advisor'
import { EconomyPanel } from '../features/economy'
import type { OperationalBand } from '../lib/types'

/**
 * A count broken into its parts, in the space one headline number used to take.
 *
 * These tiles each showed a single figure with two captions under it and half a
 * card of air below that. The parts are the reading — "62 verified" only means
 * something next to the 71 that are not.
 */
function Funnel({
  rows,
  total,
  headline,
  headlineLabel,
}: {
  rows: { label: string; value: number; color: string }[]
  total: number
  headline?: string
  headlineLabel?: string
}) {
  const safeTotal = Math.max(1, total)
  return (
    <div className="flex flex-col gap-3">
      {headline ? (
        <p className="flex items-baseline gap-2">
          <span className="text-metric font-semibold tabular-nums text-ink">{headline}</span>
          <span className="text-sm text-muted">{headlineLabel}</span>
        </p>
      ) : null}
      <span aria-hidden className="flex h-2 overflow-hidden rounded-full bg-surface-3">
        {rows
          .filter((row) => row.value > 0)
          .map((row) => (
            <span
              key={row.label}
              className="h-full"
              style={{ background: row.color, flexGrow: row.value }}
            />
          ))}
      </span>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden
              className="size-2 shrink-0 translate-y-px rounded-full"
              style={{ background: row.color }}
            />
            <span className="min-w-9 text-right text-sm font-semibold tabular-nums text-ink">
              {row.value}
            </span>
            <span className="min-w-0 flex-1 text-muted">{row.label}</span>
            <span className="tabular-nums text-faint">
              {Math.round((row.value / safeTotal) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

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

  const totalZones = [...bandCounts.values()].reduce((sum, value) => sum + value, 0)

  const severeZones = BAND_ORDER.filter(
    (band) => band === 'high' || band === 'very_high',
  ).reduce((sum, band) => sum + (bandCounts.get(band) ?? 0), 0)

  const ackRate =
    data && data.delivery_stats.total > 0
      ? Math.round((data.delivery_stats.acked / data.delivery_stats.total) * 100)
      : null

  /*
   * What period each panel actually covers. Every chart here is a claim about
   * a span of time, and none of them said which — so two panels drawn from
   * different windows looked directly comparable.
   */
  const incidentsSpan = data?.incidents_monthly ?? []
  const incidentsPeriod =
    incidentsSpan.length > 0
      ? { from: incidentsSpan[0].month, to: incidentsSpan[incidentsSpan.length - 1].month }
      : null
  const rainfallPeriod =
    rainfall.dekads.length > 0
      ? { from: rainfall.dekads[0], to: rainfall.dekads[rainfall.dekads.length - 1] }
      : null

  const totalPhase3 = (data?.food_security_by_country ?? []).reduce(
    (sum, row) => sum + (row.pop_phase3_plus ?? 0),
    0,
  )
  const totalIdps = (data?.displacement_by_country ?? []).reduce(
    (sum, row) => sum + (row.idps ?? 0),
    0,
  )
  const totalIncidents = incidentsSpan.reduce((sum, row) => sum + (row.events ?? 0), 0)
  const totalFatalities = incidentsSpan.reduce((sum, row) => sum + (row.fatalities ?? 0), 0)
  const totalReports =
    (data?.field_report_stats.verified ?? 0) +
    (data?.field_report_stats.unverified ?? 0) +
    (data?.field_report_stats.dismissed ?? 0)

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
          {/*
            Rows are sized to their content: a short summary row, then the two
            tall distributions beside the year-long incident chart, then three
            equal readouts. The band card used to carry the food-security list
            as well — under a title that said "Zones by operational band" — and
            the card beside it repeated the first four rows of the same list.
          */}
          <BentoGrid className="mb-5">
            <BentoCard span={2} tone="inverse" eyebrow="Priority signal" title="Zones at risk">
              <p className="text-metric font-semibold tabular-nums">{severeZones}</p>
              <p className="mt-2 text-sm text-muted">high or very high this cycle</p>
              <p className="mt-3 text-xs text-faint">
                {data.delivery_stats.needs_review > 0
                  ? `${data.delivery_stats.needs_review} deliveries need review`
                  : 'No delivery exceptions'}
              </p>
            </BentoCard>

            <BentoCard
              span={4}
              eyebrow="Regional picture"
              title="Band distribution"
              subtitle={`All ${totalZones} monitored zones, by the band they landed in this cycle`}
            >
              <BandDistributionBar counts={bandCounts} />
              {/* The bar shows proportion; the rows below show the counts and
                  what each band actually asks an operator to do. */}
              {/* Inline, not a stretched two-column grid: with only two or
                  three bands populated, full-width rows put the share half a
                  card away from the count it belongs to. */}
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                {BAND_ORDER.filter((band) => (bandCounts.get(band) ?? 0) > 0).map((band) => (
                  <li key={band} className="flex items-baseline gap-1.5 text-xs">
                    <BandDot band={band === 'none' ? null : band} className="translate-y-px" />
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {bandCounts.get(band) ?? 0}
                    </span>
                    <span className="text-muted">{BAND_LABELS[band]}</span>
                    <span className="tabular-nums text-faint">
                      {Math.round(((bandCounts.get(band) ?? 0) / Math.max(1, totalZones)) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </BentoCard>

            <BentoCard
              span={6}
              eyebrow="Conflict"
              title="Incidents by month"
              subtitle="Region-wide monthly totals across monitored zones"
              actions={
                <AskAboutButton question="What is driving the regional trend in conflict incidents over the last year?" />
              }
            >
              {/* The period the chart covers, and its totals, above the axis —
                  a monthly series with no stated span is uninterpretable. */}
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {incidentsPeriod ? (
                  <DateStamp tone="strong">
                    {fmtMonth(incidentsPeriod.from)} – {fmtMonth(incidentsPeriod.to)}
                  </DateStamp>
                ) : null}
                <span className="text-xs text-faint">
                  <span className="tabular-nums font-semibold text-ink">
                    {fmtCompact(totalIncidents)}
                  </span>{' '}
                  incidents ·{' '}
                  <span className="tabular-nums font-semibold text-ink">
                    {fmtCompact(totalFatalities)}
                  </span>{' '}
                  fatalities
                </span>
              </div>
              <TimeSeriesChart
                data={data.incidents_monthly as unknown as Record<string, unknown>[]}
                xKey="month"
                xFormatter={fmtMonth}
                height={280}
                series={[
                  { key: 'events', label: 'Incidents', kind: 'bar', color: CHART.cat1 },
                  { key: 'fatalities', label: 'Fatalities', kind: 'line', color: CHART.cat2 },
                ]}
              />
              {incidentTrend ? (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
                  <DateStamp tone="quiet">{fmtMonth(incidentTrend.month)}</DateStamp>
                  <span className="tabular-nums font-semibold text-ink">
                    {incidentTrend.latest}
                  </span>
                  incidents in the latest month
                  {/* Computed all along and never rendered. */}
                  <MetricDelta value={incidentTrend.delta} goodDirection="down" />
                </p>
              ) : null}
            </BentoCard>

            <BentoCard
              span={3}
              eyebrow="Food security"
              title="People in IPC 3+"
              subtitle={`${fmtCompact(totalPhase3)} across 7 countries`}
            >
              <HBarList
                items={data.food_security_by_country.map((row) => ({
                  key: row.country_iso2,
                  label: COUNTRY_NAMES[row.country_iso2] ?? row.country_iso2,
                  value: row.pop_phase3_plus,
                }))}
                formatter={fmtCompact}
                // The worst phase reached is the other half of the reading:
                // half a million people at phase 3 is not half a million at 4.
                rightSlot={(item) => {
                  const row = data.food_security_by_country.find(
                    (candidate) => candidate.country_iso2 === item.key,
                  )
                  return row?.worst_ipc_phase != null ? (
                    <IpcChip phase={row.worst_ipc_phase} className="ml-1" />
                  ) : null
                }}
              />
            </BentoCard>

            <BentoCard
              span={3}
              eyebrow="Movement"
              title="Displacement"
              subtitle={`${fmtCompact(totalIdps)} displaced within their own country`}
            >
              <HBarList
                items={data.displacement_by_country.map((row) => ({
                  key: row.country_iso2,
                  label: COUNTRY_NAMES[row.country_iso2] ?? row.country_iso2,
                  value: row.idps,
                }))}
                formatter={fmtCompact}
                color={CHART.cat4}
                rightSlot={(item) => {
                  const row = data.displacement_by_country.find(
                    (candidate) => candidate.country_iso2 === item.key,
                  )
                  return row?.refugees ? (
                    <span className="ml-1 min-w-14 text-right text-2xs tabular-nums text-faint">
                      +{fmtCompact(row.refugees)} ref.
                    </span>
                  ) : null
                }}
              />
            </BentoCard>

            {/*
              The full funnel, not just its first number. "62 verified" says
              nothing without the 71 still waiting and the 1 thrown out — and
              only verified reports move the score at all.
            */}
            <BentoCard
              span={3}
              eyebrow="Field evidence"
              title="Report funnel"
              subtitle={`${totalReports} reports received`}
            >
              <Funnel
                rows={[
                  {
                    label: 'Verified · counts toward the score',
                    value: data.field_report_stats.verified,
                    color: CHART.cat3,
                  },
                  {
                    label: 'Awaiting verification · contributes 0',
                    value: data.field_report_stats.unverified,
                    color: CHART.cat1,
                  },
                  {
                    label: 'Dismissed · stays at 0',
                    value: data.field_report_stats.dismissed,
                    color: 'var(--color-line-strong)',
                  },
                ]}
                total={totalReports}
              />
            </BentoCard>

            <BentoCard
              span={3}
              eyebrow="Dispatch"
              title="Delivery health"
              subtitle={`${data.delivery_stats.total} calls placed`}
            >
              <Funnel
                rows={[
                  {
                    label: 'Acknowledged · recipient pressed a key',
                    value: data.delivery_stats.acked,
                    color: CHART.cat3,
                  },
                  {
                    label: 'Needs review · never retried automatically',
                    value: data.delivery_stats.needs_review,
                    color: CHART.cat2,
                  },
                ]}
                total={data.delivery_stats.total}
                headline={ackRate != null ? `${ackRate}%` : '—'}
                headlineLabel="acknowledged"
              />
            </BentoCard>

            {/* Full width: nine clusters across every dekad of the year needs
                the room, and at span=2 it drove the height of the whole row. */}
            <BentoCard
              span={6}
              eyebrow="Climate"
              title="Rainfall by cluster"
              subtitle="Millimetres per 10-day period"
              actions={
                rainfallPeriod ? (
                  <DateStamp tone="strong">
                    {fmtDate(rainfallPeriod.from)} – {fmtDate(rainfallPeriod.to)}
                  </DateStamp>
                ) : null
              }
            >
              {rainfall.clusters.length > 0 ? (
                <HeatStrip
                  rows={rainfall.clusters}
                  columns={rainfall.dekads}
                  valueAt={(row, column) => rainfall.lookup.get(`${row}|${column}`) ?? null}
                  maxValue={rainfall.maxValue}
                  columnFormatter={fmtMonth}
                  rowFormatter={titleCase}
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

      {/*
        Outside the guard above, so the economies still render while the rest
        of the analytics payload is in flight.
      */}
      <BentoGrid>
        <BentoCard
          span={6}
          eyebrow="Context"
          title="Country economies"
          subtitle="World Bank indicators for the seven IGAD countries"
        >
          <EconomyPanel focusCountry={null} />
        </BentoCard>
      </BentoGrid>
    </Screen>
  )
}
