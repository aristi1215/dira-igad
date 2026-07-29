import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, Megaphone, Sigma } from 'lucide-react'
import {
  fetchAllAlerts,
  fetchFieldReports,
  fetchSituationDetail,
  fetchZoneProfile,
  fetchZones,
  prepareAlert,
  queryKeys,
} from '../lib/api'
import {
  BAND_COLORS,
  BAND_GUIDANCE,
  BAND_MAP_COLORS,
  CHART,
  fmtDate,
  fmtDateTime,
  fmtForecastWindow,
  fmtProbability,
  fmtRisk,
  fmtRiskScore,
  titleCase,
} from '../lib/format'
import { BAND_TICKS } from '../lib/explain'
import {
  BandChip,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Meter,
  PageHeader,
  Screen,
  ScreenSkeleton,
  Stat,
  StatRow,
  StatusChip,
  Tabs,
} from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import {
  FieldReportModal,
  HazardBulletins,
  ScoreExplainer,
  ShapDrivers,
  SignalsList,
} from '../features/situations'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'
import type { FieldReport } from '../lib/types'

type EvidenceTab = 'signals' | 'reports' | 'hazards'

export function SituationDetailScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showScoreExplainer, setShowScoreExplainer] = useState(false)
  const [selectedReport, setSelectedReport] = useState<FieldReport | null>(null)
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>('signals')

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
    () => zonesQuery.data?.find((z) => z.zone_id === detail?.situation.zone_id) ?? null,
    [detail?.situation.zone_id, zonesQuery.data],
  )

  const reportsQuery = useQuery({
    queryKey: queryKeys.fieldReports(detail?.situation.zone_id, null),
    queryFn: () => fetchFieldReports(detail?.situation.zone_id, null),
    enabled: Boolean(detail?.situation.zone_id),
  })
  const profileQuery = useQuery({
    queryKey: queryKeys.zoneProfile(detail?.situation.zone_id ?? 'none'),
    queryFn: () => fetchZoneProfile(detail?.situation.zone_id ?? ''),
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
    return <ScreenSkeleton />
  }
  if (detailQuery.isError || !detail) {
    return (
      <Screen>
        <ErrorNote error={detailQuery.error ?? new Error('Situation not found')} />
      </Screen>
    )
  }

  const assessments = [...detail.assessments].sort((a, b) => a.cycle.localeCompare(b.cycle))
  const latest = assessments.at(-1) ?? null
  const trajectory = assessments.map((assessment) => ({
    cycle: assessment.cycle,
    model_risk: assessment.model_risk,
    corroboration: assessment.corroboration,
  }))

  const situationAlerts = (alertsQuery.data ?? []).filter((alert) => alert.situation_id === id)
  const verifiedReports = (reportsQuery.data ?? []).filter(
    (report) => report.status === 'verified',
  )
  const hazards = profileQuery.data?.hazard_bulletins ?? []
  const signalCount = profileQuery.data?.news_signals?.length ?? 0

  const band = latest?.operational_band ?? 'none'
  const quietCycles = detail.situation.cycles_below_threshold

  return (
    <Screen>
      <PageHeader
        eyebrow={`Situation · ${titleCase(detail.situation.hazard)}`}
        title={zone ? zone.zone_name : detail.situation.zone_id}
        description={`Opened ${detail.situation.opened_cycle ?? '—'} · ${detail.situation.status}${
          detail.situation.resolved_cycle
            ? ` · resolved ${detail.situation.resolved_cycle}`
            : ''
        }`}
        actions={
          <>
            <Button
              icon={LayoutGrid}
              onClick={() => void navigate(`/zones/${detail.situation.zone_id}`)}
            >
              Zone dossier
            </Button>
            <Button
              variant="primary"
              icon={Megaphone}
              loading={prepareAlertMutation.isPending}
              onClick={() => prepareAlertMutation.mutate()}
            >
              Prepare alert
            </Button>
          </>
        }
      />

      {prepareAlertMutation.isError ? (
        <ErrorNote error={prepareAlertMutation.error} className="mb-4" />
      ) : null}

      {/* The headline answer, before any numbers. */}
      <div
        className="mb-5 rounded-lg border border-line border-l-[3px] bg-surface px-5 py-4"
        style={{
          borderLeftColor: BAND_COLORS[band],
          background: `color-mix(in srgb, ${BAND_COLORS[band]} 6%, white)`,
        }}
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <BandChip band={latest?.operational_band ?? null} />
          <span className="text-2xs text-faint">
            {fmtForecastWindow(
              latest?.window_start,
              latest?.window_end,
              latest?.horizon_dekads,
            )}
          </span>
          {quietCycles != null && quietCycles > 0 ? (
            <StatusChip tone="info">
              {quietCycles} quiet cycle{quietCycles === 1 ? '' : 's'} — resolving if it holds
            </StatusChip>
          ) : null}
        </div>
        <p className="max-w-[70ch] text-lg leading-snug font-medium text-ink">
          {BAND_GUIDANCE[band]}
        </p>
        {latest?.explanation ? (
          <p className="mt-1.5 max-w-[80ch] text-sm text-muted">{latest.explanation}</p>
        ) : null}
      </div>

      <StatRow className="mb-5">
        <Stat
          label="Conflict pressure"
          value={
            <span className="flex items-baseline gap-1">
              {fmtRiskScore(latest?.model_risk)}
              <span className="text-xs text-faint">/100</span>
            </span>
          }
          detail="Model forecast, out of 100"
          accent={BAND_MAP_COLORS[band]}
        />
        <Stat
          label="Chance of conflict"
          value={fmtProbability(latest?.prob_conflict)}
          detail="At least one incident in the window"
        />
        <Stat
          label="Expected incidents"
          value={latest ? latest.expected_incidents.toFixed(1) : '—'}
          detail="Over the forecast window"
        />
        <Stat
          label="Corroboration"
          value={fmtRisk(latest?.corroboration)}
          detail="News and verified field reports"
          accent={CHART.cat2}
        />
      </StatRow>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {/*
          The two-score rule is the product's central claim, so it comes first —
          it used to sit second, below the trajectory chart.
        */}
        <Card
          title="Two scores, never blended"
          subtitle="The band is not a black box: the exact rule is stored on every assessment"
          actions={
            latest ? (
              <Button size="sm" icon={Sigma} onClick={() => setShowScoreExplainer(true)}>
                How is this calculated?
              </Button>
            ) : undefined
          }
        >
          <div data-tour={TOUR_ANCHORS.twoScore} className="flex flex-col gap-3">
            <ScoreLine
              name="Model risk"
              hint="Climate and conflict history only — never touched by news"
              value={latest?.model_risk}
              color={CHART.cat1}
              track="var(--color-accent-ring)"
              showTicks
            />
            <ScoreLine
              name="Corroboration"
              hint="What people and media are reporting right now"
              value={latest?.corroboration}
              color={CHART.cat2}
              track="#ffd6e8"
            />
            <p className="rounded-sm border border-line bg-surface-2 px-2.5 py-2 font-mono text-2xs leading-relaxed break-words text-muted">
              {latest?.combination_rule ?? '—'}
            </p>
          </div>
        </Card>

        <Card
          title="How it got here"
          subtitle="Both scores across every assessment cycle"
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
              yFormatter={(value) => value.toFixed(1)}
            />
          ) : (
            <EmptyState>No assessments recorded yet.</EmptyState>
          )}
        </Card>
      </div>

      <Card
        title="What the model leaned on"
        subtitle="Contribution of each input to this cycle's score — select one for what it means"
        className="mb-5"
      >
        <div data-tour={TOUR_ANCHORS.shapDrivers}>
          <ShapDrivers shap={latest?.shap ?? {}} />
        </div>
      </Card>

      {/*
        News signals, field reports and hazards used to be three separate cards
        answering one question. Merged, they cost a third less scrolling.
      */}
      <Card
        title="Evidence"
        subtitle="Everything corroborating — or failing to corroborate — this forecast"
        className="mb-5"
        actions={
          <Tabs
            items={[
              { id: 'signals', label: 'News', count: signalCount || undefined },
              { id: 'reports', label: 'Field reports', count: verifiedReports.length || undefined },
              { id: 'hazards', label: 'Hazards', count: hazards.length || undefined },
            ]}
            value={evidenceTab}
            onChange={setEvidenceTab}
            layoutId="evidence-tabs"
            ariaLabel="Evidence type"
            size="sm"
          />
        }
      >
        {evidenceTab === 'signals' ? (
          <SignalsList zoneId={detail.situation.zone_id} zoneName={zone?.zone_name} />
        ) : null}

        {evidenceTab === 'reports' ? (
          verifiedReports.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {verifiedReports.slice(0, 8).map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedReport(report)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-colors duration-[120ms] hover:border-accent hover:bg-accent-soft"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusChip tone="success">Verified</StatusChip>
                      <span className="text-sm font-medium text-ink">
                        {titleCase(report.category)}
                      </span>
                      <span className="ml-auto text-2xs text-faint">
                        {fmtDate(report.reported_at)}
                      </span>
                    </span>
                    <p className="mt-1.5 text-sm text-muted">{report.narrative}</p>
                    <p className="mt-1 text-2xs text-faint">
                      {titleCase(report.reporter_role)} · severity {report.severity}/3
                      {report.verified_by ? ` · verified by ${report.verified_by}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No verified reports">
              Unverified reports contribute exactly zero corroboration until someone verifies
              them.
            </EmptyState>
          )
        ) : null}

        {evidenceTab === 'hazards' ? (
          <HazardBulletins bulletins={hazards} zoneName={zone?.zone_name} />
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Alert timeline"
          subtitle="Every alert drafted for this situation and where it stands"
        >
          {situationAlerts.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {situationAlerts.map((alert) => (
                <li key={alert.id} className="border-l-2 border-line pl-3">
                  <span className="flex flex-wrap items-center gap-2">
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
                    </StatusChip>
                    <span className="text-2xs text-faint">
                      {alert.language.toUpperCase()} · {fmtDateTime(alert.created_at)}
                    </span>
                  </span>
                  <p className="mt-1 text-sm text-muted">
                    {alert.body_text.slice(0, 140)}
                    {alert.body_text.length > 140 ? '…' : ''}
                  </p>
                  {alert.approved_by ? (
                    <p className="mt-0.5 text-2xs text-faint">
                      Approved by {alert.approved_by} · {fmtDateTime(alert.approved_at)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No alerts yet">
              Use “Prepare alert” to draft one for the approval gate.
            </EmptyState>
          )}
        </Card>

        <Card
          title="Exposure at assessment time"
          subtitle="Frozen when the assessment ran — never edited afterwards"
        >
          {latest?.exposure_snapshot && Object.keys(latest.exposure_snapshot).length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              {Object.entries(latest.exposure_snapshot).map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
                  <dt className="text-xs text-muted">{titleCase(key)}</dt>
                  <dd className="text-sm font-medium tabular-nums text-ink">
                    {value == null
                      ? '—'
                      : typeof value === 'number'
                        ? Number.isInteger(value)
                          ? value.toLocaleString('en-US')
                          : value.toFixed(2)
                        : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyState>No snapshot stored.</EmptyState>
          )}
        </Card>
      </div>

      {showScoreExplainer && latest ? (
        <ScoreExplainer assessment={latest} onClose={() => setShowScoreExplainer(false)} />
      ) : null}
      {selectedReport ? (
        <FieldReportModal
          report={selectedReport}
          zoneName={zone?.zone_name}
          onClose={() => setSelectedReport(null)}
        />
      ) : null}
    </Screen>
  )
}

function ScoreLine({
  name,
  hint,
  value,
  color,
  track,
  showTicks = false,
}: {
  name: string
  hint: string
  value: number | null | undefined
  color: string
  track: string
  showTicks?: boolean
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{name}</span>
        <span className="text-sm font-semibold tabular-nums text-ink">{fmtRisk(value)}</span>
      </div>
      <Meter
        value={value}
        color={color}
        track={track}
        ticks={showTicks ? BAND_TICKS : undefined}
        height="md"
        label={name}
      />
      <p className="mt-1 text-2xs text-faint">{hint}</p>
    </div>
  )
}
