import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, Megaphone } from 'lucide-react'
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
  titleCase,
} from '../lib/format'
import {
  BandChip,
  Button,
  BentoCard,
  BentoGrid,
  EmptyState,
  ErrorNote,
  DateStamp,
  InfoHint,
  PageHeader,
  Screen,
  ScreenSkeleton,
  StatusChip,
} from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import { EvidenceBoard, ScoreFlow, ShapDrivers } from '../features/situations'
import { AskAboutButton } from '../features/advisor'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'
import type { StatusTone } from '../components/ui'

/** Where each alert state sits on the status scale. */
const ALERT_TONE: Record<string, StatusTone> = {
  pending_approval: 'warning',
  failed: 'error',
  draft: 'neutral',
}

/** One exposure figure, as stored on the frozen snapshot. */
function fmtExposure(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2)
  }
  // The snapshot stores a few raw timestamps; `updated_at` was rendering as
  // "2026-03-21 09:00:00+00:00" in a column three words wide.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:/.test(value)) {
    return fmtDateTime(value)
  }
  return String(value)
}

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
        The headline answer, before any numbers, with the two scores that
        produced it beside rather than below it — stacked, the verdict's right
        third was permanently blank while its justification sat three cards
        down the page.
      */}
      <BentoGrid>
        <BentoCard
          span={4}
          tone="inverse"
          eyebrow="Current assessment"
          title={BAND_GUIDANCE[band]}
          subtitle={
            <DateStamp>
              Forecast window ·{' '}
              {fmtForecastWindow(
                latest?.window_start,
                latest?.window_end,
                latest?.horizon_dekads,
              )}
            </DateStamp>
          }
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <BandChip band={latest?.operational_band ?? null} />
              <DateStamp>Cycle {latest?.cycle ?? '—'}</DateStamp>
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
            {latest?.explanation ? (
              <p className="mt-4 max-w-[68ch] text-sm leading-relaxed text-muted">
                {latest.explanation}
              </p>
            ) : null}
          </div>
        </BentoCard>

        <BentoCard
          span={2}
          rowSpan={2}
          eyebrow="Score flow"
          title="Two scores, one decision"
        >
          <div data-tour={TOUR_ANCHORS.twoScore} className="flex flex-col gap-4">
            {latest ? (
              <ScoreFlow assessment={latest} />
            ) : (
              <EmptyState>No assessment recorded yet.</EmptyState>
            )}
          </div>
        </BentoCard>

        {/*
          span=4, expressed through the prop. This carried an extra
          `className="lg:col-span-7"`, which asked a six-column grid for seven
          columns — the responsive variant beat the unprefixed base, and the
          class was the last survivor of an earlier layout.
        */}
        <BentoCard
          span={4}
          title={
            <span className="inline-flex items-center gap-1.5">
              How the model worked out the risk
              <InfoHint content="These are the factors that pushed this forecast up or down; they are model contributions, not proof of cause." />
            </span>
          }
          subtitle="Each input's contribution to this cycle's score"
          actions={
            <AskAboutButton question="Which drivers are pushing this zone's risk up, and what would have to change for it to fall?" />
          }
        >
          <div data-tour={TOUR_ANCHORS.shapDrivers}>
            <ShapDrivers shap={latest?.shap ?? {}} />
          </div>
        </BentoCard>

        <BentoCard span={6} title="How it got here" subtitle="Both scores across every cycle">
          {trajectory.length > 0 ? (
            <TimeSeriesChart
              data={trajectory}
              xKey="cycle"
              series={[
                { key: 'model_risk', label: 'Model risk', kind: 'line', color: CHART.cat1 },
                {
                  key: 'corroboration',
                  label: 'Supporting evidence',
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

        {/*
          Full width. EvidenceBoard is a three-column board; at span=2 each of
          its columns was about 70px, which set the report text to two or three
          characters a line.
        */}
        <BentoCard
          span={6}
          title="Evidence"
          subtitle="What supports this forecast"
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
        </BentoCard>

        <BentoCard
          span={4}
          title="Alert timeline"
          subtitle="Every alert drafted for this situation and where it stands"
        >
          {situationAlerts.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {situationAlerts.map((alert) => (
                <li key={alert.id} className="border-l-2 border-line pl-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={ALERT_TONE[alert.status] ?? 'success'}>
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
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No alerts yet">
              Use “Prepare alert” to draft one for the approval gate.
            </EmptyState>
          )}
        </BentoCard>

        <BentoCard
          span={2}
          title="Exposure at assessment time"
          subtitle={
            latest?.created_at ? (
              <DateStamp>Frozen on {fmtDateTime(latest.created_at)}</DateStamp>
            ) : (
              'Frozen when the assessment ran'
            )
          }
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigate(`/zones/${detail.situation.zone_id}`)}
            >
              See current zone state →
            </Button>
          }
        >
          {latest?.exposure_snapshot &&
          Object.keys(latest.exposure_snapshot).length > 0 ? (
            // One column: at a third of the page, two columns wrapped every
            // label ("Pop Phase3 / Plus") onto three lines.
            <dl className="grid grid-cols-1 gap-y-1.5">
              {Object.entries(latest.exposure_snapshot).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5"
                >
                  <dt className="text-xs text-muted">{titleCase(key)}</dt>
                  <dd className="text-sm font-medium tabular-nums text-ink">
                    {fmtExposure(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyState>No point-in-time record stored.</EmptyState>
          )}
        </BentoCard>
      </BentoGrid>
    </Screen>
  )
}
