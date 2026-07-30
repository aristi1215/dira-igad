import { motion } from 'motion/react'
import { ArrowRight, Check, ShieldCheck } from 'lucide-react'
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
    /*
     * The tiles scroll; the actions do not. Six tiles cannot be guaranteed to
     * fit every viewport, and the previous single scrolling column put "Take a
     * look" and "Skip" below the fold on a laptop — the two controls the
     * overlay exists to offer.
     */
    <div className="fixed inset-0 z-modal flex flex-col bg-canvas/80 backdrop-blur-2xl">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto flex min-h-full max-w-[1100px] flex-col justify-center">
        <div className="mb-4 max-w-2xl">
          <p className="text-eyebrow text-accent uppercase">A clearer way to read risk</p>
          <h1 className="mt-1.5 text-2xl leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
            Welcome to Dira
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            A visual situation room for understanding where pressure is building,
            what supports the forecast, and what a human can do next.
          </p>
        </div>

        {/*
          No `auto-rows-fr`. Equal-height rows meant the tallest tile set the
          height of every row, and with the score tile rendering a full-size
          ScoreFlow that made a 1500px overlay of mostly empty cards with the
          footer buttons pushed off the bottom of the screen.
        */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
              // Four columns: the hero takes 2×2, the flow takes 2, and the
              // last two take 2 each — otherwise the final row stopped halfway
              // across the grid.
              className={cx(
                index === 0 && 'sm:col-span-2 sm:row-span-2',
                (index === 3 || index === 4 || index === 5) && 'sm:col-span-2',
              )}
            >
              {tile}
            </motion.div>
          ))}
        </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-surface/85 px-4 py-3 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1100px] items-center justify-end gap-3">
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
        </div>
      </footer>
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
        'flex h-full min-h-32 flex-col overflow-hidden rounded-bento border p-4',
        // Same plate as BentoCard's hero tone, for the same reason: bg-surface-3
        // beside bg-surface is a two-per-cent difference nobody reads as a hero.
        inverse ? 'tone-inverse border-transparent' : 'border-line bg-surface shadow-panel',
        className,
      )}
    >
      <p className="text-eyebrow text-faint uppercase">{eyebrow}</p>
      <h2 className="mt-1 text-md font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <div className="mt-2.5 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

function WhatDiraDoes() {
  return (
    <Tile eyebrow="What Dira does" title="Makes pressure visible" inverse>
      <p className="max-w-[34ch] text-sm leading-relaxed text-muted">
        Dira turns climate, conflict and local reports into a picture of where
        attention may be needed next.
      </p>
      <svg viewBox="0 0 360 150" className="mt-auto h-28 w-full" role="img" aria-label="Three zones warming on a map">
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
          <span>Conflict pressure</span><span className="tabular-nums text-muted">72 / 100</span>
        </div>
      </div>
      <p className="mt-auto text-xs leading-relaxed text-muted">One sentence first. The evidence is there when you need it.</p>
    </Tile>
  )
}

/**
 * A miniature of the two-score idea, not the real `ScoreFlow`.
 *
 * This used to mount the actual component and shrink it with
 * `scale-[.82]` — a transform, which changes what is painted and not what is
 * laid out, so the tile still reserved the full height of a band ladder and a
 * stored-rule disclosure inside a 250px card.
 */
function MiniScore() {
  const bars = [
    { label: 'Model forecast', value: 0.62, color: 'var(--color-band-low)' },
    { label: 'What people report', value: 0.38, color: 'var(--color-band-high)' },
  ]
  return (
    <Tile eyebrow="The score" title="Two views, one decision">
      <div className="flex flex-col gap-2.5">
        {bars.map((bar) => (
          <div key={bar.label}>
            <div className="flex items-baseline justify-between gap-2 text-2xs">
              <span className="text-muted">{bar.label}</span>
              <span className="tabular-nums text-ink">{bar.value.toFixed(2)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full"
                style={{ width: `${bar.value * 100}%`, background: bar.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Weighted 70 / 30 into one combined score — and the exact rule is written
        on every assessment.
      </p>
    </Tile>
  )
}

function SignalFlow() {
  const steps = ['Data', 'Forecast', 'Check', 'A person approves', 'Voice call']
  return (
    <Tile eyebrow="From a signal to a phone call" title="People stay in control">
      {/* Wraps rather than scrolling: a horizontal scrollbar inside a tile
          hid the last step, which is the one the tile exists to show. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {steps.map((step, index) => (
          <div key={step} className="flex items-center gap-1">
            <div
              className={cx(
                'flex min-h-11 items-center justify-center rounded-lg border px-2.5 text-center text-2xs font-medium',
                index === 3
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-surface-2 text-muted',
              )}
            >
              {step}
            </div>
            {index < steps.length - 1 ? (
              <ArrowRight size={13} className="shrink-0 text-faint" aria-hidden />
            ) : null}
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
          <span key={source} className="rounded-md border border-line bg-surface-2 px-2 py-2 text-center tabular-nums text-2xs font-semibold tracking-wide text-muted">
            {source}
          </span>
        ))}
      </div>
      <p className="mt-auto pt-3 text-xs leading-relaxed text-muted">
        Conflict pressure is Dira&apos;s forecast. News and alerts help corroborate it; food,
        displacement, hazards, markets and health are external context, not model output.
      </p>
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
