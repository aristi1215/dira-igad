import { motion } from 'motion/react'
import { CHART, BAND_COLORS, BAND_LABELS, fmtRisk } from '../../lib/format'
import { BAND_TICKS, parseCombination } from '../../lib/explain'
import { Meter } from '../../components/ui'
import { Term } from '../../components/ui/Term'
import type { SituationDetail } from '../../lib/types'

type Assessment = SituationDetail['assessments'][number]

const LADDER = ['low', 'watch', 'elevated', 'high', 'very_high'] as const

export function ScoreFlow({ assessment }: { assessment: Assessment }) {
  const breakdown = parseCombination(
    assessment.combination_rule,
    assessment.model_risk,
    assessment.corroboration,
  )
  const { newsCorroboration, fieldCorroboration, operationalScore, preBumpBand, bumped } =
    breakdown
  const activeIndex = LADDER.indexOf(preBumpBand)
  const finalIndex = LADDER.indexOf(assessment.operational_band)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">Model forecast</span>
            <span className="font-mono text-sm tabular-nums text-ink">{fmtRisk(assessment.model_risk)}</span>
          </div>
          <Meter value={assessment.model_risk} color={CHART.cat1} ticks={BAND_TICKS} height="lg" label="Model forecast" />
          <p className="mt-1 text-2xs text-faint">Climate and conflict history only</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <Term term="corroboration">What people are reporting</Term>
            <span className="font-mono text-sm tabular-nums text-ink">{fmtRisk(assessment.corroboration)}</span>
          </div>
          <Meter value={assessment.corroboration} color={CHART.cat2} ticks={BAND_TICKS} height="lg" label="What people are reporting" />
          <p className="mt-1 text-2xs text-faint">Reports in the news and verified field reports</p>
        </motion.div>
      </div>

      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <p className="mb-2 text-eyebrow text-faint">How the score is worked out</p>
        <svg viewBox="0 0 240 54" className="h-14 w-full" role="img" aria-label="70 percent model and 30 percent reports converge into one score">
          <path d="M8 10 L112 27" fill="none" stroke={CHART.cat1} strokeWidth={7} strokeLinecap="round" />
          <path d="M8 44 L112 27" fill="none" stroke={CHART.cat2} strokeWidth={3} strokeLinecap="round" />
          <path d="M112 27 L232 27" fill="none" stroke="var(--color-ink)" strokeWidth={5} strokeLinecap="round" />
          <text x="14" y="9" className="fill-muted text-[9px]">70%</text>
          <text x="14" y="53" className="fill-muted text-[9px]">30%</text>
          <text x="155" y="21" className="fill-ink text-[9px]">combined score</text>
          <text x="155" y="39" className="fill-muted text-[9px]">{operationalScore.toFixed(3)}</text>
        </svg>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs text-muted">
          <span>Model · {fmtRisk(assessment.model_risk)}</span>
          <span>News · {fmtRisk(newsCorroboration ?? 0)}</span>
          <span>Field · {fmtRisk(fieldCorroboration ?? 0)}</span>
          <span>Total · {operationalScore.toFixed(3)}</span>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-eyebrow text-faint">Risk ladder</p>
          <span className="font-mono text-2xs text-muted">{BAND_LABELS[assessment.operational_band]}</span>
        </div>
        <div className="relative flex flex-col gap-1.5">
          {LADDER.map((band, index) => (
            <div key={band} className="relative flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ background: BAND_COLORS[band] }} />
              <span className={band === preBumpBand ? 'text-xs font-semibold text-ink' : 'text-xs text-muted'}>
                {BAND_LABELS[band]}
              </span>
              {index === activeIndex ? (
                <motion.span
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className="ml-auto rounded-full bg-surface-3 px-2 py-0.5 font-mono text-2xs text-ink"
                >
                  {operationalScore.toFixed(3)}
                </motion.span>
              ) : null}
            </div>
          ))}
          {bumped && finalIndex > activeIndex ? (
            <motion.p
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="mt-1 text-xs font-medium text-accent"
            >
              ↑ raised one step — strong on-the-ground confirmation
            </motion.p>
          ) : null}
        </div>
      </div>

      <details className="border-t border-line pt-3">
        <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">
          Show the exact stored rule
        </summary>
        <p className="mt-2 break-words font-mono text-xs leading-relaxed text-muted">
          {assessment.combination_rule}
        </p>
      </details>
    </div>
  )
}
