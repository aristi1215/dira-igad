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
  BAND_GUIDANCE,
  CHART,
  fmtDateTime,
  fmtForecastWindow,
  fmtRisk,
  titleCase,
} from '../lib/format'
import { BAND_TICKS } from '../lib/explain'
import {
  BandChip,
  Button,
  BentoCard,
  BentoGrid,
  EmptyState,
  ErrorNote,
  Meter,
  PageHeader,
  Screen,
  ScreenSkeleton,
  StatusChip,
} from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import { EvidenceBoard, ScoreExplainer, ShapDrivers } from '../features/situations'
import { AskAboutButton } from '../features/advisor'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'

export function SituationDetailScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showScoreExplainer, setShowScoreExplainer] = useState(false)

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
  const hazards = profileQuery.data?.hazard_bulletins ?? []

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

      {/*
        The headline answer, before any numbers.

        The verdict and the two scores that produced it now sit side by side.
        Stacked, the banner's right third was permanently blank while the
        scores that justify it were three cards further down the page.
      */}
      <BentoGrid>
      <BentoCard span={4} tone="inverse" eyebrow="Current assessment" title={BAND_GUIDANCE[band]} subtitle={`Forecast window · ${fmtForecastWindow(latest?.window_start, latest?.window_end, latest?.horizon_dekads)}`}>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <BandChip band={latest?.operational_band ?? null} />
            <span className="font-mono text-2xs text-faint">
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
            <AskAboutButton
              question={`Explain the current assessment for ${zone?.zone_name ?? detail.situation.zone_id} in plain language, and what it means for the next 30 days.`}
              className="ml-auto"
            />
          </div>
          {/*
            The one sentence on this page that is a judgement rather than a
            measurement, so it is the one sentence set in the serif.
          */}
          {latest?.explanation ? (
            <p className="mt-4 max-w-[68ch] text-sm leading-relaxed text-white/70">
              {latest.explanation}
            </p>
          ) : null}
        </div>
      </BentoCard>

      <BentoCard span={2} rowSpan={2} eyebrow="Score flow" title="Two scores, one decision">
        <div data-tour={TOUR_ANCHORS.twoScore} className="flex flex-col gap-4">
          <ScoreLine name="Model risk" hint="Climate and conflict history only" value={latest?.model_risk} color={CHART.cat1} track="var(--color-accent-ring)" showTicks />
          <ScoreLine name="Corroboration" hint="News and verified field reports" value={latest?.corroboration} color={CHART.cat2} track="var(--color-accent-ring)" />
          <p className="rounded-md border border-line bg-surface-2 px-2.5 py-2 font-mono text-2xs leading-relaxed break-words text-muted">{latest?.combination_rule ?? '—'}</p>
          {latest ? <Button size="sm" icon={Sigma} onClick={() => setShowScoreExplainer(true)}>How?</Button> : null}
        </div>
      </BentoCard>

      {/*
        Spans rather than equal halves. `lg:grid-cols-2` stretched both cards
        to the taller one, so the drivers list dragged a column of whitespace
        alongside it on every situation with few features.
      */}
        <BentoCard
          span={4}
          title="What the model leaned on"
          subtitle="Each input's contribution to this cycle's score"
          className="lg:col-span-7"
          actions={
            <AskAboutButton question="Which drivers are pushing this zone's risk up, and what would have to change for it to fall?" />
          }
        >
          <div data-tour={TOUR_ANCHORS.shapDrivers}>
            <ShapDrivers shap={latest?.shap ?? {}} />
          </div>
        </BentoCard>

          <BentoCard span={4} title="How it got here" subtitle="Both scores across every cycle">
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
                height={190}
              />
            ) : (
              <EmptyState>No assessments recorded yet.</EmptyState>
            )}
          </BentoCard>

      <BentoCard span={2} rowSpan={2} title="Evidence" subtitle="What supports this forecast" padded={false}
        actions={<AskAboutButton question="Summarise the evidence for this situation and say where it is thin." />}>
        <EvidenceBoard
          zoneId={detail.situation.zone_id}
          zoneName={zone?.zone_name}
          reports={reportsQuery.data ?? []}
          hazards={hazards}
        />
      </BentoCard>

      <BentoCard span={4} title="Alert timeline" subtitle="Every alert drafted for this situation and where it stands">
        {situationAlerts.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {situationAlerts.map((alert) => (
              <li key={alert.id} className="border-l-2 border-line pl-3">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={alert.status === 'pending_approval' ? 'warning' : alert.status === 'failed' ? 'error' : alert.status === 'draft' ? 'neutral' : 'success'}>{alert.status.replace('_', ' ')}</StatusChip>
                  <span className="text-2xs text-faint">{alert.language.toUpperCase()} · {fmtDateTime(alert.created_at)}</span>
                </span>
                <p className="mt-1 text-sm text-muted">{alert.body_text.slice(0, 140)}{alert.body_text.length > 140 ? '…' : ''}</p>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No alerts yet">Use “Prepare alert” to draft one for the approval gate.</EmptyState>}
      </BentoCard>

      <BentoCard span={2} title="Exposure at assessment time" subtitle="Frozen when the assessment ran">
        {latest?.exposure_snapshot && Object.keys(latest.exposure_snapshot).length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {Object.entries(latest.exposure_snapshot).map(([key, value]) => <div key={key} className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5"><dt className="text-xs text-muted">{titleCase(key)}</dt><dd className="text-sm font-medium tabular-nums text-ink">{value == null ? '—' : typeof value === 'number' ? Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2) : String(value)}</dd></div>)}
          </dl>
        ) : <EmptyState>No snapshot stored.</EmptyState>}
      </BentoCard>
      </BentoGrid>

      {/*
      <Card
        title="Evidence"
        subtitle="Everything corroborating — or failing to corroborate — this forecast"
        className="group mb-5"
        padded={false}
        actions={
          <AskAboutButton question="Summarise the evidence for this situation and say where it is thin." />
        }
      >
        <EvidenceBoard
          zoneId={detail.situation.zone_id}
          zoneName={zone?.zone_name}
          reports={reportsQuery.data ?? []}
          hazards={hazards}
        />
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
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
      </div> */}

      {showScoreExplainer && latest ? (
        <ScoreExplainer assessment={latest} onClose={() => setShowScoreExplainer(false)} />
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
