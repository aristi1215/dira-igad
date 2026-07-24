import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchZones, queryKeys } from '../lib/api'
import {
  COUNTRY_NAMES,
  fmtCompact,
  fmtPct,
  fmtRisk,
} from '../lib/format'
import {
  BandChip,
  EmptyState,
  ErrorNote,
  IpcChip,
  LoadingNote,
  PageHeader,
  StatusChip,
} from '../components/ui'

export function ZonesScreen() {
  const navigate = useNavigate()
  const [countryFilter, setCountryFilter] = useState('all')
  const [search, setSearch] = useState('')

  const zonesQuery = useQuery({ queryKey: queryKeys.zones, queryFn: fetchZones })

  const zones = useMemo(
    () =>
      [...(zonesQuery.data ?? [])].sort(
        (a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1),
      ),
    [zonesQuery.data],
  )
  const countries = useMemo(
    () => [...new Set(zones.map((z) => z.country_iso2))].sort(),
    [zones],
  )

  const filtered = zones.filter(
    (zone) =>
      (countryFilter === 'all' || zone.country_iso2 === countryFilter) &&
      (search.trim() === '' ||
        zone.zone_name.toLowerCase().includes(search.trim().toLowerCase()) ||
        zone.cluster_name.toLowerCase().includes(search.trim().toLowerCase())),
  )

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Zone registry"
        title="Zones"
        description="All 22 monitored zones across 9 clusters and 7 IGAD countries, ranked by model risk. Open a dossier for the full CEWARN picture: climate, incidents, food security, displacement, markets, health, hazards and field reports."
      />

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search zone or cluster…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          Country
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
          >
            <option value="all">All</option>
            {countries.map((iso2) => (
              <option key={iso2} value={iso2}>
                {COUNTRY_NAMES[iso2] ?? iso2}
              </option>
            ))}
          </select>
        </label>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>
          {filtered.length} of {zones.length} zones
        </span>
      </div>

      {zonesQuery.isLoading ? <LoadingNote /> : null}
      {zonesQuery.isError ? <ErrorNote error={zonesQuery.error} /> : null}

      <div className="card">
        <div className="card-body flush table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Cluster</th>
                <th>Country</th>
                <th>Band</th>
                <th className="num">Model risk</th>
                <th>IPC</th>
                <th className="num">IDPs</th>
                <th className="num">Staple Δ vs 3m</th>
                <th className="num">Hazards</th>
                <th className="num">Field reports</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((zone) => (
                <tr
                  key={zone.zone_id}
                  className="clickable"
                  onClick={() => void navigate(`/zones/${zone.zone_id}`)}
                >
                  <td>
                    <strong>{zone.zone_name}</strong>
                  </td>
                  <td className="muted">{zone.cluster_name}</td>
                  <td>{COUNTRY_NAMES[zone.country_iso2] ?? zone.country_iso2}</td>
                  <td>
                    <BandChip band={zone.operational_band} />
                  </td>
                  <td className="num">{fmtRisk(zone.model_risk)}</td>
                  <td>
                    <IpcChip phase={zone.ipc_phase} />
                  </td>
                  <td className="num">{fmtCompact(zone.idps)}</td>
                  <td className="num">{fmtPct(zone.staple_pct_vs_3m_avg)}</td>
                  <td className="num">{zone.active_hazards ?? 0}</td>
                  <td className="num">
                    {zone.verified_field_reports_recent ?? 0}
                    {zone.unverified_field_reports_recent ? (
                      <>
                        {' '}
                        <StatusChip tone="warning">
                          {zone.unverified_field_reports_recent} unverified
                        </StatusChip>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!zonesQuery.isLoading && filtered.length === 0 ? (
            <EmptyState>No zones match the current filters.</EmptyState>
          ) : null}
        </div>
      </div>
    </div>
  )
}
