import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchMapSituations,
  fetchPendingAlerts,
  queryKeys,
} from '../lib/api'
import {
  BAND_LABELS,
  BAND_MAP_COLORS,
  BAND_ORDER,
  COUNTRY_NAMES,
  fmtProbability,
  fmtRisk,
  titleCase,
} from '../lib/format'
import {
  BandChip,
  EmptyState,
  ErrorNote,
  LoadingNote,
  PageHeader,
  StatTile,
  StatusChip,
} from '../components/ui'

export function SituationsScreen() {
  const navigate = useNavigate()
  const [bandFilter, setBandFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('open')
  const [countryFilter, setCountryFilter] = useState('all')

  const situationsQuery = useQuery({
    queryKey: queryKeys.mapSituations,
    queryFn: fetchMapSituations,
  })
  const pendingAlertsQuery = useQuery({
    queryKey: queryKeys.pendingAlerts,
    queryFn: fetchPendingAlerts,
    retry: 1,
  })

  const all = useMemo(
    () =>
      (situationsQuery.data?.features ?? [])
        .map((f) => f.properties)
        .sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1)),
    [situationsQuery.data],
  )

  const countries = useMemo(
    () => [...new Set(all.map((s) => s.country_iso2))].sort(),
    [all],
  )

  const filtered = all.filter(
    (s) =>
      (bandFilter === 'all' || s.operational_band === bandFilter) &&
      (statusFilter === 'all' || s.situation_status === statusFilter) &&
      (countryFilter === 'all' || s.country_iso2 === countryFilter),
  )

  const open = all.filter((s) => s.situation_status === 'open')
  const severe = open.filter(
    (s) => s.operational_band === 'high' || s.operational_band === 'very_high',
  )
  const corroborated = open.filter((s) => (s.corroboration ?? 0) > 0)

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Situation registry"
        title="Situations"
        description="Every open or resolved conflict-pressure situation, one row per zone×hazard. Risk is the pure model score; the operational band is model risk combined with corroboration under the written rule."
      />

      <div className="stat-row">
        <StatTile
          label="Open situations"
          value={open.length}
          accent={BAND_MAP_COLORS.elevated}
        />
        <StatTile
          label="High / Very high"
          value={severe.length}
          accent={BAND_MAP_COLORS.high}
        />
        <StatTile
          label="With corroboration"
          value={corroborated.length}
          detail="News or verified field reports"
          accent={BAND_MAP_COLORS.low}
        />
        <StatTile
          label="Alerts pending approval"
          value={pendingAlertsQuery.data?.length ?? 0}
          detail="Waiting at the human gate"
          accent={BAND_MAP_COLORS.watch}
        />
      </div>

      <div className="filter-bar">
        <label>
          Band
          <select value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}>
            <option value="all">All</option>
            {BAND_ORDER.filter((b) => b !== 'none').map((band) => (
              <option key={band} value={band}>
                {BAND_LABELS[band]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </label>
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
          {filtered.length} of {all.length} situations
        </span>
      </div>

      {situationsQuery.isLoading ? <LoadingNote /> : null}
      {situationsQuery.isError ? <ErrorNote error={situationsQuery.error} /> : null}

      <div className="card">
        <div className="card-body flush table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Country</th>
                <th>Hazard</th>
                <th>Band</th>
                <th className="num">Model risk</th>
                <th className="num">Corroboration</th>
                <th className="num">P(conflict)</th>
                <th>Status</th>
                <th>Cycle</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.situation_id}
                  className="clickable"
                  onClick={() => void navigate(`/situations/${s.situation_id}`)}
                >
                  <td>
                    <strong>{s.zone_name}</strong>
                  </td>
                  <td>{COUNTRY_NAMES[s.country_iso2] ?? s.country_iso2}</td>
                  <td>{titleCase(s.hazard)}</td>
                  <td>
                    <BandChip band={s.operational_band} />
                  </td>
                  <td className="num">{fmtRisk(s.model_risk)}</td>
                  <td className="num">{fmtRisk(s.corroboration)}</td>
                  <td className="num">{fmtProbability(s.prob_conflict)}</td>
                  <td>
                    <StatusChip
                      tone={s.situation_status === 'open' ? 'warning' : 'neutral'}
                    >
                      {s.situation_status}
                    </StatusChip>
                  </td>
                  <td className="mono">{s.cycle ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!situationsQuery.isLoading && filtered.length === 0 ? (
            <EmptyState>No situations match the current filters.</EmptyState>
          ) : null}
        </div>
      </div>
    </div>
  )
}
