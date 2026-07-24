import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAllAlerts,
  fetchFieldReports,
  fetchSituationDetail,
  fetchZones,
  prepareAlert,
  queryKeys,
} from '../lib/api'
import {
  BAND_MAP_COLORS,
  CHART,
  fmtDate,
  fmtDateTime,
  fmtProbability,
  fmtRisk,
  titleCase,
} from '../lib/format'
import {
  BandChip,
  Card,
  EmptyState,
  ErrorNote,
  LoadingNote,
  PageHeader,
  ScoreMeter,
  StatTile,
  StatusChip,
} from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import { SignalsList } from '../features/situations'

export function SituationDetailScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const detailQuery = useQuery({
    queryKey: queryKeys.situationDetail(id),
    queryFn: () => fetchSituationDetail(id),
    enabled: id.length > 0,
  })
  const zonesQuery = useQuery({ queryKey: queryKeys.zones, queryFn: fetchZones })
  const alertsQuery = useQuery({
    queryKey: queryKeys.allAlerts,
    queryFn: fetchAllAlerts,
    retry: 1,
  })

  const detail = detailQuery.data
  const zone = useMemo(
    () =>
      zonesQuery.data?.find((z) => z.zone_id === detail?.situation.zone_id) ??
      null,
    [detail?.situation.zone_id, zonesQuery.data],
  )

  const reportsQuery = useQuery({
    queryKey: queryKeys.fieldReports(detail?.situation.zone_id, null),
    queryFn: () => fetchFieldReports(detail?.situation.zone_id, null),
    enabled: Boolean(detail?.situation.zone_id),
  })

  const prepareAlertMutation = useMutation({
    mutationFn: () => prepareAlert(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingAlerts })
      void queryClient.invalidateQueries({ queryKey: queryKeys.allAlerts })
      void navigate('/dispatch')
    },
  })

  if (detailQuery.isLoading) {
    return (
      <div className="screen">
        <LoadingNote>Loading situation…</LoadingNote>
      </div>
    )
  }
  if (detailQuery.isError || !detail) {
    return (
      <div className="screen">
        <ErrorNote error={detailQuery.error ?? new Error('Situation not found')} />
      </div>
    )
  }

  const assessments = [...detail.assessments].sort((a, b) =>
    a.cycle.localeCompare(b.cycle),
  )
  const latest = assessments.at(-1) ?? null
  const trajectory = assessments.map((a) => ({
    cycle: a.cycle,
    model_risk: a.model_risk,
    corroboration: a.corroboration,
  }))

  const shapEntries = Object.entries(latest?.shap ?? {})
    .map(([feature, value]) => ({ feature, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 8)
  const shapMax = Math.max(0.001, ...shapEntries.map((e) => Math.abs(e.value)))

  const situationAlerts = (alertsQuery.data ?? []).filter(
    (alert) => alert.situation_id === id,
  )
  const verifiedReports = (reportsQuery.data ?? []).filter(
    (r) => r.status === 'verified',
  )

  return (
    <div className="screen">
      <PageHeader
        eyebrow={`Situation · ${titleCase(detail.situation.hazard)}`}
        title={zone ? zone.zone_name : detail.situation.zone_id}
        description={`Opened cycle ${detail.situation.opened_cycle ?? '—'} · status ${detail.situation.status}${
          detail.situation.resolved_cycle
            ? ` · resolved ${detail.situation.resolved_cycle}`
            : ''
        }`}
        actions={
          <>
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                void navigate(`/zones/${detail.situation.zone_id}`)
              }
            >
              Zone dossier
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={prepareAlertMutation.isPending}
              onClick={() => prepareAlertMutation.mutate()}
            >
              {prepareAlertMutation.isPending ? 'Drafting…' : 'Prepare alert'}
            </button>
          </>
        }
      />
      {prepareAlertMutation.isError ? (
        <ErrorNote error={prepareAlertMutation.error} />
      ) : null}

      <div className="stat-row">
        <StatTile
          label="Operational band"
          value={<BandChip band={latest?.operational_band ?? null} />}
          accent={BAND_MAP_COLORS[latest?.operational_band ?? 'none']}
        />
        <StatTile label="Model risk" value={fmtRisk(latest?.model_risk)} />
        <StatTile label="Corroboration" value={fmtRisk(latest?.corroboration)} />
        <StatTile
          label="P(conflict)"
          value={fmtProbability(latest?.prob_conflict)}
          detail="Next dekad"
        />
        <StatTile
          label="Expected incidents"
          value={latest ? latest.expected_incidents.toFixed(1) : '—'}
        />
      </div>

      <div className="grid-2">
        <Card
          title="Risk trajectory"
          subtitle="Model risk and corroboration per assessment cycle"
        >
          {trajectory.length > 0 ? (
            <TimeSeriesChart
              data={trajectory}
              xKey="cycle"
              series={[
                { key: 'model_risk', label: 'Model risk', kind: 'line', color: CHART.cat1 },
                {
                  key: 'corroboration',
                  label: 'Corroboration',
                  kind: 'line',
                  color: CHART.cat2,
                },
              ]}
              yFormatter={(v) => v.toFixed(1)}
            />
          ) : (
            <EmptyState>No assessments recorded yet.</EmptyState>
          )}
        </Card>

        <Card
          title="Two-score combination"
          subtitle="The band is never a black box — the exact rule is stored on every assessment"
        >
          <div className="score-panel">
            <div className="score-line">
              <span className="score-name">Model risk (pure)</span>
              <ScoreMeter value={latest?.model_risk} color={CHART.cat1} />
              <span className="score-value">{fmtRisk(latest?.model_risk)}</span>
            </div>
            <div className="score-line">
              <span className="score-name">Corroboration</span>
              <ScoreMeter
                value={latest?.corroboration}
                color={CHART.cat2}
                track="#ffd6e8"
              />
              <span className="score-value">{fmtRisk(latest?.corroboration)}</span>
            </div>
            <p className="rule-text">{latest?.combination_rule ?? '—'}</p>
            {latest?.explanation ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                {latest.explanation}
              </p>
            ) : null}
          </div>
        </Card>

        <Card
          title="Model drivers"
          subtitle="Feature attributions for the latest assessment (|SHAP|)"
        >
          {shapEntries.length > 0 ? (
            <ul className="drivers-list">
              {shapEntries.map((entry) => (
                <li key={entry.feature}>
                  <span>{titleCase(entry.feature)}</span>
                  <span className="driver-bar">
                    <span
                      style={{
                        width: `${(Math.abs(entry.value) / shapMax) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="driver-value">
                    {entry.value >= 0 ? '+' : '−'}
                    {Math.abs(entry.value).toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No driver attribution available.</EmptyState>
          )}
        </Card>

        <Card
          title="Frozen exposure snapshot"
          subtitle="Context captured at assessment time — bitemporal, never retro-edited"
        >
          {latest?.exposure_snapshot &&
          Object.keys(latest.exposure_snapshot).length > 0 ? (
            <div className="table-scroll">
              <table className="data-table">
                <tbody>
                  {Object.entries(latest.exposure_snapshot).map(([key, value]) => (
                    <tr key={key}>
                      <td className="muted">{titleCase(key)}</td>
                      <td className="num">
                        {value == null
                          ? '—'
                          : typeof value === 'number'
                            ? Number.isInteger(value)
                              ? value.toLocaleString('en-US')
                              : value.toFixed(2)
                            : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No snapshot stored.</EmptyState>
          )}
        </Card>

        <Card
          title="News signals"
          subtitle="LLM-extracted signals feeding the news corroboration channel"
        >
          <SignalsList zoneId={detail.situation.zone_id} />
        </Card>

        <Card
          title="Verified field reports"
          subtitle="Only verified reports count toward corroboration — unverified contribute exactly 0"
        >
          {verifiedReports.length > 0 ? (
            <ul className="feed-list">
              {verifiedReports.slice(0, 6).map((report) => (
                <li key={report.id} className="feed-item">
                  <div className="feed-item-head">
                    <StatusChip tone="success">verified</StatusChip>
                    <strong>{titleCase(report.category)}</strong>
                    <span className="spacer" />
                    <small>{fmtDate(report.reported_at)}</small>
                  </div>
                  <p>{report.narrative}</p>
                  <small>
                    {titleCase(report.reporter_role)} · severity {report.severity}/3
                    {report.verified_by ? ` · verified by ${report.verified_by}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No verified field reports for this zone.</EmptyState>
          )}
        </Card>
      </div>

      <Card
        title="Alert timeline"
        subtitle="Every alert drafted for this situation and its gate status"
      >
        {situationAlerts.length > 0 ? (
          <ul className="timeline">
            {situationAlerts.map((alert) => (
              <li key={alert.id}>
                <StatusChip
                  tone={
                    alert.status === 'pending_approval'
                      ? 'warning'
                      : alert.status === 'failed'
                        ? 'error'
                        : alert.status === 'draft'
                          ? 'neutral'
                          : 'success'
                  }
                >
                  {alert.status.replace('_', ' ')}
                </StatusChip>{' '}
                {alert.language.toUpperCase()} alert · {alert.body_text.slice(0, 120)}
                {alert.body_text.length > 120 ? '…' : ''}
                <small>
                  Created {fmtDateTime(alert.created_at)}
                  {alert.approved_by
                    ? ` · approved by ${alert.approved_by} ${fmtDateTime(alert.approved_at)}`
                    : ''}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            No alerts yet — use “Prepare alert” to draft one for the approval gate.
          </EmptyState>
        )}
      </Card>
    </div>
  )
}
