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
  BandDot,
  BentoCard,
  BentoGrid,
  Callout,
  DataTable,
  EmptyState,
  ErrorNote,
  Eyebrow,
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
  const attentionZones = zones.filter(
    (zone) => zone.operational_band === 'high' || zone.operational_band === 'very_high',
  )
  const topZones = zones.slice(0, 6)

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

      <BentoGrid>
        <BentoCard span={4} eyebrow="Regional picture" title="Where the region stands" subtitle="Click a band to filter the registry">
          <BandDistributionBar
            counts={bandCounts}
            selected={bandFilter}
            onSelect={setBandFilter}
          />
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><Eyebrow>Zones</Eyebrow><p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{zones.length}</p></div>
            <div><Eyebrow>High+</Eyebrow><p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{attentionZones.length}</p></div>
            <div><Eyebrow>Filtered</Eyebrow><p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{filtered.length}</p></div>
            <div><Eyebrow>Countries</Eyebrow><p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{countries.length}</p></div>
          </div>
        </BentoCard>

        <BentoCard span={2} tone="inverse" eyebrow="Priority signal" title="Needs attention now">
          <p className="font-mono text-4xl font-semibold tabular-nums">{attentionZones.length}</p>
          <ul className="mt-4 flex flex-col gap-1 text-sm text-white/75">
            {attentionZones.slice(0, 4).map((zone) => <li key={zone.zone_id}>{zone.zone_name}</li>)}
            {attentionZones.length > 4 ? <li className="text-xs text-white/50">+{attentionZones.length - 4} more</li> : null}
          </ul>
        </BentoCard>

        {topZones.map((zone) => (
          <BentoCard key={zone.zone_id} span={1} interactive>
            <div className="flex items-start justify-between gap-2">
              <BandDot band={zone.operational_band} />
              <span className="font-mono text-xl font-semibold tabular-nums">{fmtRiskScore(zone.model_risk)}</span>
            </div>
            <p className="mt-4 truncate text-sm font-semibold text-ink">{zone.zone_name}</p>
            <Sparkline
              values={(trends?.[zone.zone_id] ?? []).map((point) => point.model_risk)}
              width={110}
              height={22}
              color={BAND_MAP_COLORS[zone.operational_band ?? 'none']}
              className="mt-3 w-full"
            />
          </BentoCard>
        ))}

        <BentoCard span={6} eyebrow="Filter the registry" title="Find a zone">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
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
                {countries.map((iso2) => <option key={iso2} value={iso2}>{COUNTRY_NAMES[iso2] ?? iso2}</option>)}
              </Select>
            </Field>
            <span className="mb-1.5 font-mono text-xs tabular-nums text-faint">{filtered.length} / {zones.length}</span>
          </div>
        </BentoCard>
        <BentoCard span={6} padded={false} title="All monitored zones">
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
        </BentoCard>
      </BentoGrid>

      {totalUnverified > 0 ? (
        <Callout tone="warning" className="mb-4">
          {totalUnverified} recent field report{totalUnverified === 1 ? '' : 's'} awaiting
          verification. Until verified they contribute exactly zero corroboration.
        </Callout>
      ) : null}

    </Screen>
  )
}
