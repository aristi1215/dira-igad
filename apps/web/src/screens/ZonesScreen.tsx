import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SearchX } from 'lucide-react'
import { fetchZones, queryKeys } from '../lib/api'
import {
  BAND_MAP_COLORS,
  COUNTRY_NAMES,
  fmtCompact,
  fmtPct,
  fmtRiskScore,
} from '../lib/format'
import {
  BandChip,
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
          <span className="w-6 text-right font-medium tabular-nums">
            {fmtRiskScore(zone.model_risk)}
          </span>
        </span>
      ),
      sortBy: (zone) => zone.model_risk ?? -1,
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
    <Screen>
      <PageHeader
        eyebrow="Zone registry"
        title="Zones"
        description="All 22 monitored zones across 9 clusters and 7 IGAD countries. Open a dossier for the full picture: climate, incidents, food security, displacement, markets, health and field reports."
      />

      {zonesQuery.isError ? <ErrorNote error={zonesQuery.error} className="mb-4" /> : null}

      {/* The distribution is both the summary and the filter. */}
      <Card
        title="Where the region stands"
        subtitle="Select a band to filter the table below"
        className="mb-5"
      >
        <BandDistributionBar
          counts={bandCounts}
          selected={bandFilter}
          onSelect={setBandFilter}
        />
        {totalUnverified > 0 ? (
          <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">
            {totalUnverified} recent field report{totalUnverified === 1 ? '' : 's'} awaiting
            verification. Until verified they contribute exactly zero corroboration.
          </p>
        ) : null}
      </Card>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search zone or cluster…"
          label="Search zones"
          className="w-64"
        />
        <Field label="Country" className="w-44">
          <Select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}>
            <option value="all">All countries</option>
            {countries.map((iso2) => (
              <option key={iso2} value={iso2}>
                {COUNTRY_NAMES[iso2] ?? iso2}
              </option>
            ))}
          </Select>
        </Field>
        <span className="ml-auto pb-2 text-xs text-faint tabular-nums">
          {filtered.length} of {zones.length}
        </span>
      </div>

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
