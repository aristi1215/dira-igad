import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFieldReport,
  dismissFieldReport,
  fetchZoneProfile,
  queryKeys,
  verifyFieldReport,
} from '../lib/api'
import {
  CHART,
  COUNTRY_NAMES,
  fmtCompact,
  fmtDate,
  fmtMonth,
  fmtNumber,
  fmtPct,
  titleCase,
} from '../lib/format'
import {
  Card,
  EmptyState,
  ErrorNote,
  IpcChip,
  LoadingNote,
  PageHeader,
  StatTile,
  StatusChip,
} from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import type { FieldReport, MarketPriceRow } from '../lib/types'

const REPORT_CATEGORIES = [
  'water_dispute',
  'pasture_dispute',
  'livestock_raid',
  'migration_influx',
  'market_disruption',
  'road_blockage',
  'armed_presence',
  'peace_meeting',
]
const REPORTER_ROLES = ['field_monitor', 'peace_committee', 'drm_officer', 'chief']

export function ZoneDossierScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const profileQuery = useQuery({
    queryKey: queryKeys.zoneProfile(id),
    queryFn: () => fetchZoneProfile(id),
    enabled: id.length > 0,
  })

  const profile = profileQuery.data

  const latestIpc = profile?.food_security.at(-1) ?? null
  const latestDisplacement = profile?.displacement.at(-1) ?? null

  const climateData = useMemo(
    () =>
      (profile?.climate ?? []).map((row) => ({
        dekad: row.dekad_start,
        rain_mm: row.rain_mm,
        ndvi: row.ndvi_mean,
      })),
    [profile?.climate],
  )

  const displacementData = useMemo(
    () =>
      (profile?.displacement ?? []).map((row) => ({
        date: row.snapshot_date,
        idps: row.idps,
        refugees: row.refugees,
      })),
    [profile?.displacement],
  )

  const { latestPrices, termsOfTrade } = useMemo(
    () => summarizePrices(profile?.market_prices ?? []),
    [profile?.market_prices],
  )

  if (profileQuery.isLoading) {
    return (
      <div className="screen">
        <LoadingNote>Loading zone dossier…</LoadingNote>
      </div>
    )
  }
  if (profileQuery.isError || !profile) {
    return (
      <div className="screen">
        <ErrorNote error={profileQuery.error ?? new Error('Zone not found')} />
      </div>
    )
  }

  const situationId =
    profile.situation && typeof profile.situation.id === 'string'
      ? profile.situation.id
      : null

  return (
    <div className="screen">
      <PageHeader
        eyebrow={`Zone dossier · ${profile.zone.cluster_name}`}
        title={profile.zone.name}
        description={`${COUNTRY_NAMES[profile.zone.country_iso2] ?? profile.zone.country_iso2} · everything CEWARN knows about this zone, with each observation stamped by when it became available (bitemporal).`}
        actions={
          situationId ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() => void navigate(`/situations/${situationId}`)}
            >
              View open situation
            </button>
          ) : undefined
        }
      />

      <div className="stat-row">
        <StatTile
          label="Population"
          value={fmtCompact(profile.exposure?.population ?? null)}
          detail={
            profile.exposure?.pastoralist_share != null
              ? `${Math.round(profile.exposure.pastoralist_share * 100)}% pastoralist`
              : undefined
          }
        />
        <StatTile
          label="Food security"
          value={<IpcChip phase={latestIpc?.ipc_phase ?? null} />}
          detail={
            latestIpc?.pop_phase3_plus != null
              ? `${fmtCompact(latestIpc.pop_phase3_plus)} in Phase 3+`
              : undefined
          }
        />
        <StatTile
          label="IDPs"
          value={fmtCompact(latestDisplacement?.idps ?? null)}
          detail={
            latestDisplacement
              ? `as of ${fmtDate(latestDisplacement.snapshot_date)}`
              : undefined
          }
        />
        <StatTile
          label="Water points"
          value={fmtNumber(profile.exposure?.water_points ?? null)}
        />
        <StatTile
          label="Markets"
          value={fmtNumber(profile.exposure?.markets ?? null)}
        />
        <StatTile label="Recipients" value={profile.recipients.length} />
      </div>

      <div className="grid-2">
        <Card title="Rainfall" subtitle="mm per dekad (CHIRPS-shaped seeded series)">
          {climateData.length > 0 ? (
            <TimeSeriesChart
              data={climateData}
              xKey="dekad"
              xFormatter={fmtMonth}
              series={[
                { key: 'rain_mm', label: 'Rain (mm)', kind: 'bar', color: CHART.cat1 },
              ]}
            />
          ) : (
            <EmptyState>No climate series.</EmptyState>
          )}
        </Card>

        <Card title="Vegetation (NDVI)" subtitle="Dekadal mean — shown separately, never on a second axis">
          {climateData.length > 0 ? (
            <TimeSeriesChart
              data={climateData}
              xKey="dekad"
              xFormatter={fmtMonth}
              series={[
                { key: 'ndvi', label: 'NDVI', kind: 'line', color: CHART.cat3 },
              ]}
              yFormatter={(v) => v.toFixed(2)}
            />
          ) : (
            <EmptyState>No NDVI series.</EmptyState>
          )}
        </Card>

        <Card title="Conflict incidents" subtitle="ACLED-shaped monthly events and fatalities">
          {profile.incidents_monthly.length > 0 ? (
            <TimeSeriesChart
              data={profile.incidents_monthly as unknown as Record<string, unknown>[]}
              xKey="month"
              xFormatter={fmtMonth}
              series={[
                { key: 'events', label: 'Events', kind: 'bar', color: CHART.cat1 },
                { key: 'fatalities', label: 'Fatalities', kind: 'line', color: CHART.cat2 },
              ]}
            />
          ) : (
            <EmptyState>No incident history.</EmptyState>
          )}
        </Card>

        <Card title="Displacement" subtitle="IOM DTM-shaped snapshots">
          {displacementData.length > 0 ? (
            <TimeSeriesChart
              data={displacementData}
              xKey="date"
              xFormatter={fmtMonth}
              series={[
                { key: 'idps', label: 'IDPs', kind: 'line', color: CHART.cat1 },
                { key: 'refugees', label: 'Refugees', kind: 'line', color: CHART.cat4 },
              ]}
            />
          ) : (
            <EmptyState>No displacement snapshots.</EmptyState>
          )}
        </Card>
      </div>

      <Card
        title="Market prices"
        subtitle="WFP-shaped monthly observations; Δ compares against the trailing 3-month average"
        actions={
          termsOfTrade ? (
            <StatusChip tone={termsOfTrade.kg < 40 ? 'error' : 'info'}>
              Terms of trade: 1 goat ≈ {termsOfTrade.kg.toFixed(0)} kg maize
            </StatusChip>
          ) : undefined
        }
      >
        {latestPrices.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Commodity</th>
                  <th>Month</th>
                  <th className="num">Price</th>
                  <th className="num">Δ vs 3-month avg</th>
                </tr>
              </thead>
              <tbody>
                {latestPrices.map((row) => (
                  <tr key={`${row.market_name}-${row.commodity}`}>
                    <td>{row.market_name}</td>
                    <td>{titleCase(row.commodity)}</td>
                    <td>{fmtMonth(row.month)}</td>
                    <td className="num">
                      {fmtNumber(row.price)} {row.currency}/{row.unit}
                    </td>
                    <td className="num">
                      <span
                        style={{
                          color:
                            (row.pct_vs_3m_avg ?? 0) > 10
                              ? 'var(--err-fg)'
                              : undefined,
                        }}
                      >
                        {fmtPct(row.pct_vs_3m_avg)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No market price observations.</EmptyState>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Health surveillance" subtitle="Weekly disease reporting">
          {profile.health.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Disease</th>
                    <th className="num">Cases</th>
                    <th className="num">Deaths</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...profile.health]
                    .sort((a, b) => b.week_start.localeCompare(a.week_start))
                    .slice(0, 10)
                    .map((row) => (
                      <tr key={`${row.week_start}-${row.disease}`}>
                        <td>{fmtDate(row.week_start)}</td>
                        <td>{titleCase(row.disease)}</td>
                        <td className="num">{row.cases}</td>
                        <td className="num">{row.deaths}</td>
                        <td>
                          <StatusChip
                            tone={
                              row.status === 'outbreak'
                                ? 'error'
                                : row.status === 'alert'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {row.status}
                          </StatusChip>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No surveillance data.</EmptyState>
          )}
        </Card>

        <Card title="Hazard bulletins" subtitle="Locust, flood, heat and drought advisories">
          {profile.hazard_bulletins.length > 0 ? (
            <ul className="feed-list">
              {profile.hazard_bulletins.map((bulletin) => (
                <li key={bulletin.id} className="feed-item">
                  <div className="feed-item-head">
                    <StatusChip
                      tone={
                        bulletin.severity === 'warning'
                          ? 'error'
                          : bulletin.severity === 'watch'
                            ? 'warning'
                            : 'info'
                      }
                    >
                      {bulletin.severity}
                    </StatusChip>
                    <strong>{titleCase(bulletin.hazard_type)}</strong>
                    <span className="spacer" />
                    <small>
                      {fmtDate(bulletin.valid_from)} →{' '}
                      {bulletin.valid_to ? fmtDate(bulletin.valid_to) : 'open'}
                    </small>
                  </div>
                  <p>{bulletin.headline}</p>
                  {bulletin.detail ? <small>{bulletin.detail}</small> : null}
                  <small className="muted">{bulletin.source}</small>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No active or recent bulletins.</EmptyState>
          )}
        </Card>

        <Card
          title="Recent conflict events"
          subtitle="Most recent ACLED-shaped events in this zone"
        >
          {profile.recent_events.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="num">Fatalities</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.recent_events.slice(0, 10).map((event, index) => (
                    <tr key={`${event.event_date}-${index}`}>
                      <td>{fmtDate(event.event_date)}</td>
                      <td>{event.event_type}</td>
                      <td className="num">{event.fatalities}</td>
                      <td className="muted">{event.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No recent events.</EmptyState>
          )}
        </Card>

        <Card
          title="Alert recipients"
          subtitle="Who receives approved voice alerts for this zone"
        >
          {profile.recipients.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Channel</th>
                    <th>Language</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.recipients.map((recipient) => (
                    <tr key={recipient.id}>
                      <td>{recipient.name}</td>
                      <td className="mono">{recipient.phone_e164}</td>
                      <td>{recipient.channel}</td>
                      <td>{recipient.language.toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No recipients registered.</EmptyState>
          )}
        </Card>
      </div>

      <FieldReportsCard zoneId={id} reports={profile.field_reports} />
    </div>
  )
}

function summarizePrices(rows: MarketPriceRow[]): {
  latestPrices: MarketPriceRow[]
  termsOfTrade: { kg: number } | null
} {
  if (rows.length === 0) {
    return { latestPrices: [], termsOfTrade: null }
  }
  const latestMonth = rows.reduce(
    (max, row) => (row.month > max ? row.month : max),
    rows[0].month,
  )
  const latestPrices = rows
    .filter((row) => row.month === latestMonth)
    .sort((a, b) =>
      `${a.market_name}${a.commodity}`.localeCompare(`${b.market_name}${b.commodity}`),
    )
  const goat = latestPrices.find((row) => row.commodity.includes('goat'))
  const maize = latestPrices.find(
    (row) => row.commodity.includes('maize') && row.unit === 'kg',
  )
  const termsOfTrade =
    goat && maize && maize.price > 0 && goat.currency === maize.currency
      ? { kg: goat.price / maize.price }
      : null
  return { latestPrices, termsOfTrade }
}

function FieldReportsCard({
  zoneId,
  reports,
}: {
  zoneId: string
  reports: FieldReport[]
}) {
  const queryClient = useQueryClient()
  const [signer, setSigner] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    reporter_role: REPORTER_ROLES[0],
    category: REPORT_CATEGORIES[0],
    severity: 2,
    narrative: '',
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.zoneProfile(zoneId) })
    void queryClient.invalidateQueries({ queryKey: ['field-reports'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.zones })
  }

  const verifyMutation = useMutation({
    mutationFn: (reportId: string) => verifyFieldReport(reportId, signer.trim()),
    onSuccess: invalidate,
  })
  const dismissMutation = useMutation({
    mutationFn: (reportId: string) => dismissFieldReport(reportId, signer.trim()),
    onSuccess: invalidate,
  })
  const createMutation = useMutation({
    mutationFn: () =>
      createFieldReport({
        zone_id: zoneId,
        reporter_role: form.reporter_role,
        category: form.category,
        severity: form.severity,
        narrative: form.narrative.trim(),
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, narrative: '' }))
      setShowForm(false)
      invalidate()
    },
  })

  const canGate = signer.trim().length > 0
  const sorted = [...reports].sort((a, b) =>
    b.reported_at.localeCompare(a.reported_at),
  )

  return (
    <Card
      title="Field reports"
      subtitle="CEWARN-style monitor reports. Verification is a human decision — unverified or dismissed reports contribute exactly 0 to corroboration."
      actions={
        <>
          <input
            type="text"
            placeholder="Your name (to verify/dismiss)"
            value={signer}
            onChange={(e) => setSigner(e.target.value)}
          />
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : 'New report'}
          </button>
        </>
      }
    >
      {showForm ? (
        <form
          className="form-grid"
          style={{ marginBottom: '1rem' }}
          onSubmit={(event) => {
            event.preventDefault()
            if (form.narrative.trim()) createMutation.mutate()
          }}
        >
          <label>
            Reporter role
            <select
              value={form.reporter_role}
              onChange={(e) => setForm({ ...form, reporter_role: e.target.value })}
            >
              {REPORTER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {titleCase(role)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {REPORT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {titleCase(category)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity (1–3)
            <select
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })}
            >
              <option value={1}>1 — Low</option>
              <option value={2}>2 — Medium</option>
              <option value={3}>3 — High</option>
            </select>
          </label>
          <label className="span-2">
            Narrative
            <textarea
              rows={3}
              value={form.narrative}
              onChange={(e) => setForm({ ...form, narrative: e.target.value })}
              placeholder="What was observed, where, and by whom…"
            />
          </label>
          <div className="span-2">
            <button
              type="submit"
              className="button button-primary"
              disabled={createMutation.isPending || form.narrative.trim().length === 0}
            >
              {createMutation.isPending ? 'Submitting…' : 'Submit (born unverified)'}
            </button>
          </div>
          {createMutation.isError ? (
            <div className="span-2">
              <ErrorNote error={createMutation.error} />
            </div>
          ) : null}
        </form>
      ) : null}

      {sorted.length > 0 ? (
        <ul className="feed-list">
          {sorted.map((report) => (
            <li key={report.id} className="feed-item">
              <div className="feed-item-head">
                <StatusChip
                  tone={
                    report.status === 'verified'
                      ? 'success'
                      : report.status === 'dismissed'
                        ? 'neutral'
                        : 'warning'
                  }
                >
                  {report.status}
                </StatusChip>
                <strong>{titleCase(report.category)}</strong>
                <span
                  className="severity-pips"
                  aria-label={`Severity ${report.severity} of 3`}
                >
                  {[1, 2, 3].map((n) => (
                    <span key={n} className={n <= report.severity ? 'on' : undefined} />
                  ))}
                </span>
                <span className="spacer" />
                <small>{fmtDate(report.reported_at)}</small>
              </div>
              <p>{report.narrative}</p>
              <small>
                {titleCase(report.reporter_role)}
                {report.verified_by
                  ? ` · ${report.status} by ${report.verified_by}`
                  : ''}
              </small>
              {report.status === 'unverified' ? (
                <div className="feed-actions">
                  <button
                    type="button"
                    className="button button-primary button-small"
                    disabled={!canGate || verifyMutation.isPending}
                    title={canGate ? undefined : 'Enter your name above first'}
                    onClick={() => verifyMutation.mutate(report.id)}
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    className="button button-danger button-small"
                    disabled={!canGate || dismissMutation.isPending}
                    title={canGate ? undefined : 'Enter your name above first'}
                    onClick={() => dismissMutation.mutate(report.id)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No field reports for this zone.</EmptyState>
      )}
      {verifyMutation.isError ? <ErrorNote error={verifyMutation.error} /> : null}
      {dismissMutation.isError ? <ErrorNote error={dismissMutation.error} /> : null}
    </Card>
  )
}
