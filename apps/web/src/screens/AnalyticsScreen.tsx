import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAnalytics, queryKeys } from '../lib/api'
import {
  BAND_LABELS,
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
  LoadingNote,
  PageHeader,
  StatTile,
} from '../components/ui'
import { HBarList, HeatStrip, TimeSeriesChart } from '../components/charts'
import { EconomyPanel } from '../features/economy'
import type { OperationalBand } from '../lib/types'

export function AnalyticsScreen() {
  const analyticsQuery = useQuery({
    queryKey: queryKeys.analytics,
    queryFn: fetchAnalytics,
  })

  const data = analyticsQuery.data

  const bandRows = useMemo(() => {
    const counts = new Map(
      (data?.band_distribution ?? []).map((row) => [row.band, row.zones]),
    )
    return BAND_ORDER.map((band) => ({
      band,
      zones: counts.get(band) ?? 0,
    })).filter((row) => row.zones > 0)
  }, [data?.band_distribution])

  const rainfall = useMemo(() => {
    const rows = data?.climate_by_cluster ?? []
    const clusters = [...new Set(rows.map((r) => r.cluster_id))].sort()
    const dekads = [...new Set(rows.map((r) => r.dekad_start))].sort()
    const lookup = new Map(
      rows.map((r) => [`${r.cluster_id}|${r.dekad_start}`, r.rain_mm]),
    )
    const maxValue = Math.max(1, ...rows.map((r) => r.rain_mm ?? 0))
    return { clusters, dekads, lookup, maxValue }
  }, [data?.climate_by_cluster])

  const severeZones = bandRows
    .filter((row) => row.band === 'high' || row.band === 'very_high')
    .reduce((sum, row) => sum + row.zones, 0)
  const ackRate =
    data && data.delivery_stats.total > 0
      ? Math.round((data.delivery_stats.acked / data.delivery_stats.total) * 100)
      : null

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Regional analytics"
        title="Analytics"
        description="Cross-zone trends for the whole IGAD monitoring area: conflict, climate, food security, displacement, field reporting and dispatch performance."
      />

      {analyticsQuery.isLoading ? <LoadingNote /> : null}
      {analyticsQuery.isError ? <ErrorNote error={analyticsQuery.error} /> : null}

      {data ? (
        <>
          <div className="stat-row">
            <StatTile
              label="Zones high / very high"
              value={severeZones}
              accent={BAND_MAP_COLORS.high}
            />
            <StatTile
              label="Verified field reports"
              value={data.field_report_stats.verified}
              detail={`${data.field_report_stats.unverified} unverified · ${data.field_report_stats.dismissed} dismissed`}
              accent={BAND_MAP_COLORS.ack}
            />
            <StatTile
              label="Deliveries"
              value={data.delivery_stats.total}
              detail={
                data.delivery_stats.needs_review > 0
                  ? `${data.delivery_stats.needs_review} need review`
                  : 'None need review'
              }
            />
            <StatTile
              label="Ack rate"
              value={ackRate != null ? `${ackRate}%` : '—'}
              detail="Keypad acknowledgements"
              accent={BAND_MAP_COLORS.low}
            />
          </div>

          <div className="grid-2">
            <Card
              title="Incidents & fatalities"
              subtitle="Region-wide monthly totals (ACLED-shaped)"
            >
              <TimeSeriesChart
                data={data.incidents_monthly as unknown as Record<string, unknown>[]}
                xKey="month"
                xFormatter={fmtMonth}
                series={[
                  { key: 'events', label: 'Events', kind: 'bar', color: CHART.cat1 },
                  {
                    key: 'fatalities',
                    label: 'Fatalities',
                    kind: 'line',
                    color: CHART.cat2,
                  },
                ]}
              />
            </Card>

            <Card
              title="Operational band distribution"
              subtitle="Zones per band in the latest cycle — band colors carry the meaning"
            >
              <div className="hbar-list">
                {bandRows.map((row) => (
                  <div key={row.band} className="hbar-row">
                    <span className="hbar-label">
                      {BAND_LABELS[row.band as OperationalBand | 'none']}
                    </span>
                    <span className="hbar-track">
                      <span
                        className="hbar-fill"
                        style={{
                          width: `${(row.zones / Math.max(1, ...bandRows.map((r) => r.zones))) * 100}%`,
                          background: BAND_MAP_COLORS[row.band],
                        }}
                      />
                    </span>
                    <span className="hbar-value">{row.zones}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              title="Population in IPC Phase 3+"
              subtitle="People in crisis or worse, by country (latest analysis periods)"
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
          </div>

          <Card
            title="Rainfall by cluster"
            subtitle="mm per dekad, darker = wetter — dry strips flag drought pressure"
          >
            {rainfall.clusters.length > 0 ? (
              <HeatStrip
                rows={rainfall.clusters}
                columns={rainfall.dekads}
                valueAt={(row, col) => rainfall.lookup.get(`${row}|${col}`) ?? null}
                maxValue={rainfall.maxValue}
                columnFormatter={fmtMonth}
                title="Rainfall by cluster and dekad"
              />
            ) : null}
          </Card>
        </>
      ) : null}

      <Card
        title="Country economies"
        subtitle="World Bank indicators for the seven IGAD countries"
      >
        <EconomyPanel focusCountry={null} />
      </Card>
    </div>
  )
}
