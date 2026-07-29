import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SearchX } from 'lucide-react'
import { fetchMapTrends, fetchZones, queryKeys } from '../lib/api'
import {
  BAND_MAP_COLORS,
  COUNTRY_NAMES,
  fmtCompact,
  fmtPct,
  fmtRiskScore,
} from '../lib/format'
import {
  BandChip,
  Callout,
  Card,
  DataTable,
  EmptyState,
  ErrorNote,
  Field,
  IpcChip,
  Meter,
  PageHeader,
  Screen,
  SearchInput,
  Select,
  Sparkline,
  StatusChip,
  type Column,
} from '../components/ui'
import { BandDistributionBar, type BandCounts } from '../components/BandDistributionBar'
import type { OperationalBand, ZoneSummary } from '../lib/types'

export function ZonesScreen() {
  const navigate = useNavigate()
  const [countryFilter, setCountryFilter] = useState('all')
  const [bandFilter, setBandFilter] = useState<OperationalBand | 'none' | null>(null)
  const [search, setSearch] = useState('')

  const zonesQuery = useQuery({ queryKey: queryKeys.zones, queryFn: fetchZones })
  const trendsQuery = useQuery({
    queryKey: queryKeys.mapTrends,
    queryFn: () => fetchMapTrends(6),
    staleTime: 5 * 60 * 1000,
  })
  const trends = trendsQuery.data

  const zones = useMemo(
    () =>
      [...(zonesQuery.data ?? [])].sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1)),
    [zonesQuery.data],
  )
  const countries = useMemo(
    () => [...new Set(zones.map((zone) => zone.country_iso2))].sort(),
    [zones],
  )

  const bandCounts = useMemo<BandCounts>(() => {
    const counts: BandCounts = new Map()
    for (const zone of zones) {
      const band = zone.operational_band ?? 'none'
      counts.set(band, (counts.get(band) ?? 0) + 1)
    }
    return counts
  }, [zones])

  const needle = search.trim().toLowerCase()
  const filtered = zones.filter(
    (zone) =>
      (countryFilter === 'all' || zone.country_iso2 === countryFilter) &&
      (bandFilter == null || (zone.operational_band ?? 'none') === bandFilter) &&
      (needle === '' ||
        zone.zone_name.toLowerCase().includes(needle) ||
        zone.cluster_name.toLowerCase().includes(needle)),
  )

  const totalUnverified = zones.reduce(
    (sum, zone) => sum + (zone.unverified_field_reports_recent ?? 0),
    0,
  )

  const columns: Column<ZoneSummary>[] = [
    {
      key: 'zone',
      header: 'Zone',
      render: (zone) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink">{zone.zone_name}</span>
          <span className="text-2xs text-faint">
            {COUNTRY_NAMES[zone.country_iso2] ?? zone.country_iso2} · {zone.cluster_name}
          </span>
        </span>
      ),
      sortBy: (zone) => zone.zone_name,
    },
    {
      key: 'band',
      header: 'Band',
      render: (zone) => <BandChip band={zone.operational_band} />,
      sortBy: (zone) => zone.model_risk ?? -1,
    },
    {
      key: 'model_risk',
      header: 'Model risk',
      align: 'right',
      width: '9rem',
      render: (zone) => (
        <span className="flex items-center justify-end gap-2">
          <Meter
            value={zone.model_risk}
            color={BAND_MAP_COLORS[zone.operational_band ?? 'none']}
            track="var(--color-line)"
            height="sm"
            animate={false}
            className="w-14"
          />
          <span className="w-6 text-right font-mono font-medium tabular-nums">
            {fmtRiskScore(zone.model_risk)}
          </span>
        </span>
      ),
      sortBy: (zone) => zone.model_risk ?? -1,
    },
    {
      key: 'trend',
      header: 'Trend',
      width: '5rem',
      render: (zone) => {
        const history = (trends?.[zone.zone_id] ?? []).map((point) => point.model_risk)
        return history.length >= 2 ? (
          <Sparkline
            values={history}
            width={54}
            height={18}
            color={BAND_MAP_COLORS[zone.operational_band ?? 'none']}
          />
        ) : (
          <span className="text-2xs text-faint">—</span>
        )
      },
      sortBy: (zone) => {
        const history = trends?.[zone.zone_id] ?? []
        if (history.length < 2) return 0
        return history[history.length - 1].model_risk - history[history.length - 2].model_risk
      },
    },
    {
      key: 'ipc',
      header: 'Food security',
      render: (zone) => <IpcChip phase={zone.ipc_phase} />,
      sortBy: (zone) => zone.ipc_phase ?? -1,
    },
    {
      key: 'idps',
      header: 'Displaced',
      align: 'right',
      render: (zone) => fmtCompact(zone.idps),
      sortBy: (zone) => zone.idps ?? -1,
    },
    {
      key: 'staple',
      header: 'Staple vs 3m',
      align: 'right',
      render: (zone) => fmtPct(zone.staple_pct_vs_3m_avg),
      sortBy: (zone) => zone.staple_pct_vs_3m_avg ?? -Infinity,
      secondary: true,
    },
    {
      key: 'reports',
      header: 'Field reports',
      align: 'right',
      render: (zone) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          {zone.verified_field_reports_recent ?? 0}
          {zone.unverified_field_reports_recent ? (
            <StatusChip tone="warning">
              {zone.unverified_field_reports_recent} unverified
            </StatusChip>
          ) : null}
        </span>
      ),
      sortBy: (zone) => zone.verified_field_reports_recent ?? -1,
      secondary: true,
    },
  ]

  return (
    <Screen width="wide">
      <PageHeader
        eyebrow="Zone registry"
        title="Zones"
        description="All 22 monitored zones across 9 clusters and 7 IGAD countries."
      />

      {zonesQuery.isError ? <ErrorNote error={zonesQuery.error} className="mb-4" /> : null}

      {/*
        Distribution, search and filters in one bar.

        The distribution used to be a full-width card wrapping a single 24px
        bar — the thinnest card in the app, and a whole band of chrome around
        one element. It is the same control, folded into the filter row it was
        already acting as.
      */}
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border border-line bg-surface px-3 py-2.5">
        <div className="min-w-[18rem] flex-1">
          <span className="font-condensed mb-1.5 block text-2xs font-semibold tracking-[0.09em] text-muted uppercase">
            Where the region stands
          </span>
          <BandDistributionBar
            counts={bandCounts}
            selected={bandFilter}
            onSelect={setBandFilter}
          />
        </div>
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search zone or cluster…"
          label="Search zones"
          className="w-56"
        />
        <Field label="Country" className="w-40">
          <Select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}>
            <option value="all">All countries</option>
            {countries.map((iso2) => (
              <option key={iso2} value={iso2}>
                {COUNTRY_NAMES[iso2] ?? iso2}
              </option>
            ))}
          </Select>
        </Field>
        <span className="mb-1.5 font-mono text-xs tabular-nums text-faint">
          {filtered.length} / {zones.length}
        </span>
      </div>

      {totalUnverified > 0 ? (
        <Callout tone="warning" className="mb-4">
          {totalUnverified} recent field report{totalUnverified === 1 ? '' : 's'} awaiting
          verification. Until verified they contribute exactly zero corroboration.
        </Callout>
      ) : null}

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(zone) => zone.zone_id}
          onRowClick={(zone) => void navigate(`/zones/${zone.zone_id}`)}
          rowAccent={(zone) => BAND_MAP_COLORS[zone.operational_band ?? 'none']}
          loading={zonesQuery.isLoading}
          caption="Monitored zones"
          empty={
            <EmptyState icon={SearchX} title="No zones match">
              Try clearing the search or the band filter.
            </EmptyState>
          }
        />
      </Card>
    </Screen>
  )
}
