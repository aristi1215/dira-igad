import { useState, type ReactNode } from 'react'
import { Modal } from '../../components/Modal'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  Brain,
  ClipboardCheck,
  ExternalLink,
  Megaphone,
  Newspaper,
  Sigma,
  X,
} from 'lucide-react'
import {
  BAND_COLORS,
  BAND_GUIDANCE,
  COUNTRY_NAMES,
  fmtCompact,
  fmtForecastWindow,
  fmtRisk,
  fmtRiskScore,
} from '../../lib/format'
import { BAND_TICKS, parseCombination } from '../../lib/explain'
import type {
  OperationalBand,
  SituationDetail,
  SituationFeatureProperties,
  ZoneSummary,
  ZoneTrendPoint,
} from '../../lib/types'
import { BandChip, Button, IconButton, IpcChip, Meter, Sparkline } from '../../components/ui'
import { cx } from '../../lib/cx'
import { Term } from '../../components/ui/Term'
import { ScoreFlow } from '../situations'
import { AskAboutButton } from '../advisor'
import { T } from '../../lib/motion'
import { TOUR_ANCHORS } from '../tour/tourAnchors'

type Assessment = SituationDetail['assessments'][number]

/**
 * The map already carries every field ScoreFlow needs, so the card can
 * open the same explanation the situation screen uses rather than restating
 * the arithmetic in new words.
 */
function toAssessment(situation: SituationFeatureProperties): Assessment | null {
  if (
    situation.model_risk == null ||
    situation.corroboration == null ||
    !situation.combination_rule ||
    !situation.operational_band ||
    !situation.model_band
  ) {
    return null
  }
  return {
    id: situation.assessment_id ?? situation.situation_id,
    cycle: situation.cycle ?? '—',
    model_risk: situation.model_risk,
    model_band: situation.model_band,
    corroboration: situation.corroboration,
    operational_band: situation.operational_band,
    combination_rule: situation.combination_rule,
    explanation: situation.explanation,
    shap: situation.shap,
    exposure_snapshot: situation.exposure_snapshot,
    prob_conflict: situation.prob_conflict ?? 0,
    expected_incidents: situation.expected_incidents ?? 0,
    created_at: '',
    horizon_dekads: situation.horizon_dekads,
    window_start: situation.window_start,
    window_end: situation.window_end,
  }
}

export function ZoneCard({
  zone,
  situation,
  trend = [],
  onClose,
  onPrepareAlert,
  preparingAlert,
}: {
  zone: ZoneSummary
  situation: SituationFeatureProperties | null
  /** Recent cycles for this zone, oldest first. Empty when unavailable. */
  trend?: ZoneTrendPoint[]
  onClose: () => void
  onPrepareAlert: (situationId: string) => void
  preparingAlert: boolean
}) {
  const navigate = useNavigate()
  const [explaining, setExplaining] = useState(false)

  const band: OperationalBand | 'none' = zone.operational_band ?? 'none'
  const urgent = band === 'high' || band === 'very_high'
  const assessment = situation ? toAssessment(situation) : null

  const breakdown =
    situation?.combination_rule && situation.model_risk != null && situation.corroboration != null
      ? parseCombination(situation.combination_rule, situation.model_risk, situation.corroboration)
      : null

  return (
    <>
      <motion.section
        aria-label={`${zone.zone_name} summary`}
        data-tour={TOUR_ANCHORS.mapZoneCard}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={T.enter}
        className="pointer-events-auto absolute top-3 right-3 z-map-panel flex max-h-[calc(100%-1.5rem)] w-[22.5rem] max-w-[88vw] flex-col overflow-hidden rounded-bento border border-line bg-surface shadow-panel"
      >
        <header className="flex shrink-0 items-start justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg leading-tight font-semibold tracking-[-0.01em] text-ink">
              {zone.zone_name}
            </h2>
            <p className="mt-0.5 truncate text-2xs text-faint">
              {COUNTRY_NAMES[zone.country_iso2] ?? zone.country_iso2} · {zone.cluster_name}
            </p>
          </div>
          <IconButton icon={X} label="Clear selection" size="sm" onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* 1. What to do — the plain-language answer comes first. */}
          <div
            className="grid gap-4 border-l-[3px] px-4 py-3 lg:grid-cols-2"
            style={{
              borderLeftColor: BAND_COLORS[band],
              background: `color-mix(in srgb, ${BAND_COLORS[band]} 8%, white)`,
            }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <BandChip band={zone.operational_band} />
              <IpcChip phase={zone.ipc_phase} />
            </div>
            <p className="col-span-2 text-[15px] leading-snug font-medium text-ink">
              {BAND_GUIDANCE[band]}
            </p>

            {/* 2. How much — and, just as importantly, which way. */}
            <div className="flex items-end justify-between gap-3">
              <span className="flex items-end gap-2.5">
                <span
                  className="font-mono text-3xl leading-none font-semibold tabular-nums"
                  style={{ color: BAND_COLORS[band] }}
                >
                  {fmtRiskScore(zone.model_risk)}
                </span>
                <span className="pb-0.5 text-xs text-faint">/100</span>
              </span>
              {trend.length >= 2 ? (
                <span className="flex flex-col items-end gap-0.5 pb-0.5">
                  <Sparkline
                    values={trend.map((point) => point.model_risk)}
                    width={72}
                    height={22}
                    color={BAND_COLORS[band]}
                  />
                  <span className="text-eyebrow text-faint uppercase">
                    Last {trend.length} cycles
                  </span>
                </span>
              ) : null}
            </div>
            <Meter
              value={zone.model_risk}
              color={BAND_COLORS[band]}
              track="var(--color-line)"
              ticks={BAND_TICKS}
              height="lg"
              className="col-span-2 mt-1.5"
              label={`Conflict pressure for ${zone.zone_name}`}
            />
            <p className="col-span-2 text-2xs text-faint">
              Conflict pressure ·{' '}
              {fmtForecastWindow(
                situation?.window_start,
                situation?.window_end,
                situation?.horizon_dekads,
              ).toLowerCase()}
            </p>
          </div>

          {/* 3. Why — evidence the map already had but never showed. */}
          {situation ? (
            <div className="group border-b border-line px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-eyebrow text-faint uppercase">
                  Why
                </p>
                <AskAboutButton
                  question={`Why is ${zone.zone_name} rated ${zone.operational_band ?? 'as it is'} this cycle? Walk me through the evidence.`}
                  className="-my-1"
                />
              </div>
              <ul className="flex flex-col gap-1.5">
                <EvidenceRow
                  icon={Brain}
                  label="Model forecast"
                  value={fmtRisk(situation.model_risk)}
                />
                <EvidenceRow
                  icon={Newspaper}
                  label={<Term term="corroboration">What people are reporting</Term>}
                  value={
                    breakdown?.newsCorroboration != null
                      ? `${fmtRisk(situation.corroboration)} · news`
                      : fmtRisk(situation.corroboration)
                  }
                />
                <EvidenceRow
                  icon={ClipboardCheck}
                  label="Verified reports"
                  value={String(zone.verified_field_reports_recent ?? 0)}
                />
              </ul>

              {situation.explanation ? (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">
                  {situation.explanation}
                </p>
              ) : null}

              {assessment ? (
                <button
                  type="button"
                  onClick={() => setExplaining(true)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-xs text-xs font-medium text-accent transition-colors hover:text-accent-hover"
                >
                  <Sigma size={12} strokeWidth={2} aria-hidden />
                  How is this calculated?
                </button>
              ) : null}
            </div>
          ) : null}

          {/*
            4. Who is exposed.
            Nine readings rather than four. The card had room for them all
            along — the lower third was simply empty — and every one of these
            was already travelling in the /zones payload.
          */}
          <div className="grid grid-cols-3 gap-px bg-line">
            <ExposureCell label="People" value={fmtCompact(zone.population)} />
            <ExposureCell label="Displaced" value={fmtCompact(zone.idps)} />
            <ExposureCell label="Refugees" value={fmtCompact(zone.refugees)} />
            <ExposureCell
              label="Pastoralist"
              value={
                zone.pastoralist_share == null
                  ? '—'
                  : `${Math.round(zone.pastoralist_share * 100)}%`
              }
            />
            <ExposureCell label="Water points" value={fmtCompact(zone.water_points)} />
            <ExposureCell label="Markets" value={fmtCompact(zone.markets)} />
            <ExposureCell
              label="Health alerts"
              value={String(zone.active_health_alerts ?? 0)}
            />
            <ExposureCell
              label="Verified reports"
              value={String(zone.verified_field_reports_recent ?? 0)}
            />
            <ExposureCell label="Hazards" value={String(zone.active_hazards ?? 0)} />
          </div>

          {/*
            Staple prices, when there are any. This is the one indicator here
            that is signed — a market 30% above its own average is a different
            situation from one 30% below — so it gets its own line rather than
            a cell that could only show the magnitude.
          */}
          {zone.staple_pct_vs_3m_avg != null ? (
            <p className="flex items-baseline justify-between gap-2 border-t border-line px-4 py-2.5 text-xs">
              <span className="text-muted">
                {zone.staple_commodity ?? 'Staple'} vs 3-month average
              </span>
              <span
                className={cx(
                  'font-mono font-medium tabular-nums',
                  zone.staple_pct_vs_3m_avg > 5
                    ? 'text-err-fg'
                    : zone.staple_pct_vs_3m_avg < -5
                      ? 'text-ok-fg'
                      : 'text-muted',
                )}
              >
                {zone.staple_pct_vs_3m_avg > 0 ? '+' : ''}
                {Math.round(zone.staple_pct_vs_3m_avg)}%
              </span>
            </p>
          ) : null}
        </div>

        {/* 5. Act. The primary action follows the band. */}
        <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3">
          {zone.situation_id && urgent ? (
            <Button
              variant="primary"
              icon={Megaphone}
              block
              loading={preparingAlert}
              onClick={() => onPrepareAlert(zone.situation_id!)}
            >
              {preparingAlert ? 'Drafting alert…' : 'Prepare alert'}
            </Button>
          ) : (
            <Button
              variant="primary"
              iconRight={ExternalLink}
              block
              onClick={() => void navigate(`/zones/${zone.zone_id}`)}
            >
              Open dossier
            </Button>
          )}

          <div className="flex gap-2">
            {zone.situation_id && urgent ? (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => void navigate(`/zones/${zone.zone_id}`)}
              >
                Dossier
              </Button>
            ) : null}
            {zone.situation_id ? (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => void navigate(`/situations/${zone.situation_id}`)}
              >
                Situation
              </Button>
            ) : null}
            {zone.situation_id && !urgent ? (
              <Button
                variant="secondary"
                className="flex-1"
                loading={preparingAlert}
                onClick={() => onPrepareAlert(zone.situation_id!)}
              >
                Prepare alert
              </Button>
            ) : null}
          </div>
        </div>
      </motion.section>

      {explaining && assessment ? (
        <Modal
          eyebrow={`Assessment cycle ${assessment.cycle}`}
          title="How this assessment was worked out"
          onClose={() => setExplaining(false)}
          wide
        >
          <ScoreFlow assessment={assessment} />
        </Modal>
      ) : null}
    </>
  )
}

function EvidenceRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Brain
  label: ReactNode
  value: string
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <Icon size={13} strokeWidth={1.75} aria-hidden className="shrink-0 text-faint" />
      <span className="flex-1 text-muted">{label}</span>
      <span className="font-medium tabular-nums text-ink">{value}</span>
    </li>
  )
}

function ExposureCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-2.5">
      <span className="block text-md font-semibold tabular-nums text-ink">{value}</span>
      <span className="block text-2xs text-faint">{label}</span>
    </div>
  )
}
