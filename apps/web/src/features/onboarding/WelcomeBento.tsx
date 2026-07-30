import { motion } from 'motion/react'
import { ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { ScoreFlow } from '../situations'
import { cx } from '../../lib/cx'

export function WelcomeBento({
  onTakeLook,
  onSkip,
}: {
  onTakeLook: () => void
  onSkip: () => void
}) {
  const tiles = [
    <WhatDiraDoes key="what" />,
    <ZoneThumbnail key="zone" />,
    <MiniScore key="score" />,
    <SignalFlow key="flow" />,
    <DataSources key="data" />,
    <WhatItWillNotDo key="limits" />,
  ]

  return (
    <div className="fixed inset-0 z-modal overflow-y-auto bg-canvas/80 px-4 py-6 backdrop-blur-2xl sm:px-8 sm:py-10">
      <div className="mx-auto flex min-h-full max-w-[1100px] flex-col justify-center">
        <div className="mb-6 max-w-2xl">
          <p className="text-eyebrow text-accent">A clearer way to read risk</p>
          <h1 className="mt-2 text-3xl leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-4xl">
            Welcome to Dira
          </h1>
          <p className="mt-3 text-md leading-relaxed text-muted">
            A visual situation room for understanding where pressure is building,
            what supports the forecast, and what a human can do next.
          </p>
        </div>

        <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className={cx(index === 0 && 'sm:col-span-2 sm:row-span-2', index === 3 && 'sm:col-span-2')}
            >
              {tile}
            </motion.div>
          ))}
        </div>

        <footer className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onTakeLook}
            className="inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-2 text-sm font-medium text-white shadow-panel transition-transform hover:-translate-y-px"
          >
            Take a look <ArrowRight size={16} aria-hidden />
          </button>
        </footer>
      </div>
    </div>
  )
}

function Tile({
  eyebrow,
  title,
  children,
  inverse = false,
  className,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
  inverse?: boolean
  className?: string
}) {
  return (
    <section
      className={cx(
        'flex h-full min-h-40 flex-col overflow-hidden rounded-bento border border-line p-5',
        inverse ? 'bg-ink text-white' : 'bg-surface shadow-panel',
        className,
      )}
    >
      <p className={cx('text-eyebrow', inverse ? 'text-white/60' : 'text-faint')}>{eyebrow}</p>
      <h2 className={cx('mt-1.5 text-lg font-semibold tracking-[-0.02em]', inverse ? 'text-white' : 'text-ink')}>
        {title}
      </h2>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

function WhatDiraDoes() {
  return (
    <Tile eyebrow="What Dira does" title="Makes pressure visible" inverse>
      <p className="max-w-[32ch] text-md leading-relaxed text-white/75">
        Dira turns climate, conflict and local reports into a picture of where
        attention may be needed next.
      </p>
      <svg viewBox="0 0 360 150" className="mt-auto h-36 w-full" role="img" aria-label="Three zones warming on a map">
        <path d="M10 116 C70 76 84 32 145 44 S220 102 274 66 S322 30 350 42" fill="none" stroke="var(--color-line-strong)" strokeWidth="2" />
        <path d="M20 18 L68 8 L104 33 L90 68 L42 62 Z" fill="var(--color-band-low)" opacity=".65" />
        <path d="M120 54 L163 24 L207 43 L194 88 L145 96 Z" fill="var(--color-band-watch)" opacity=".8">
          <animate attributeName="opacity" values=".35;.95;.35" dur="3.6s" repeatCount="indefinite" />
        </path>
        <path d="M220 76 L258 42 L309 56 L328 104 L274 128 L234 112 Z" fill="var(--color-band-high)" opacity=".85">
          <animate attributeName="opacity" values=".4;1;.4" dur="3.6s" begin=".8s" repeatCount="indefinite" />
        </path>
        <circle cx="72" cy="100" r="5" fill="var(--color-band-elevated)" />
        <circle cx="185" cy="116" r="5" fill="var(--color-band-high)" />
        <circle cx="302" cy="24" r="5" fill="var(--color-band-very-high)" />
      </svg>
    </Tile>
  )
}

function ZoneThumbnail() {
  return (
    <Tile eyebrow="A zone" title="Start with one place">
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">Mandera East</p>
            <p className="mt-0.5 text-2xs text-faint">Kenya · Mandera cluster</p>
          </div>
          <span className="rounded-full bg-band-high/10 px-2 py-0.5 text-2xs font-medium text-band-high">High</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full w-[72%] rounded-full bg-band-high" />
        </div>
        <div className="mt-2 flex justify-between text-2xs text-faint">
          <span>Conflict pressure</span><span className="font-mono text-muted">72 / 100</span>
        </div>
      </div>
      <p className="mt-auto text-xs leading-relaxed text-muted">One sentence first. The evidence is there when you need it.</p>
    </Tile>
  )
}

function MiniScore() {
  const assessment = {
    id: 'welcome',
    cycle: '2026-03-11',
    model_risk: 0.62,
    model_band: 'elevated' as const,
    corroboration: 0.38,
    operational_band: 'elevated' as const,
    combination_rule:
      'corroboration=max(news 0.38, verified_field_reports 0.22); v1_weighted_70_30_with_corroboration_bump',
    explanation: null,
    shap: {},
    exposure_snapshot: {},
    prob_conflict: 0.62,
    expected_incidents: 1,
    created_at: '',
    horizon_dekads: 3,
    window_start: null,
    window_end: null,
  }
  return (
    <Tile eyebrow="The score" title="Two views, one decision">
      <div className="origin-top-left scale-[.82]">
        <ScoreFlow assessment={assessment} />
      </div>
    </Tile>
  )
}

function SignalFlow() {
  const steps = ['Data', 'Forecast', 'Check', 'A person approves', 'Voice call']
  return (
    <Tile eyebrow="From a signal to a phone call" title="People stay in control">
      <div className="flex flex-1 items-center gap-1 overflow-x-auto pb-1">
        {steps.map((step, index) => (
          <div key={step} className="flex min-w-[100px] flex-1 items-center gap-1">
            <div className={cx('flex min-h-14 flex-1 items-center justify-center rounded-lg border px-2 text-center text-2xs font-medium', index === 3 ? 'border-accent bg-accent/10 text-accent' : 'border-line bg-surface-2 text-muted')}>
              {step}
            </div>
            {index < steps.length - 1 ? <ArrowRight size={13} className="shrink-0 text-faint" aria-hidden /> : null}
          </div>
        ))}
      </div>
    </Tile>
  )
}

function DataSources() {
  return (
    <Tile eyebrow="Where the data comes from" title="Many lenses, one picture">
      <div className="grid grid-cols-3 gap-2">
        {['ACLED', 'CHIRPS', 'IPC', 'DTM', 'WFP', 'WHO'].map((source) => (
          <span key={source} className="rounded-md border border-line bg-surface-2 px-2 py-2 text-center font-mono text-2xs font-semibold tracking-wide text-muted">
            {source}
          </span>
        ))}
      </div>
    </Tile>
  )
}

function WhatItWillNotDo() {
  return (
    <Tile eyebrow="What it will not do" title="Safety rails are part of the product">
      <div className="flex flex-col gap-3 text-xs leading-relaxed text-muted">
        <p className="flex gap-2"><ShieldCheck size={16} className="shrink-0 text-accent" aria-hidden /> It never names groups.</p>
        <p className="flex gap-2"><Check size={16} className="shrink-0 text-accent" aria-hidden /> It never sends anything on its own.</p>
      </div>
    </Tile>
  )
}
