import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Moon, Sun } from 'lucide-react'
import { useThemeStore } from '../../stores/theme'
import { BrandMark } from '../../layouts/BrandMark'
import { EASE, staggerDelay } from '../../lib/motion'
import { cx } from '../../lib/cx'

/** How long each step stays highlighted before the cycle moves on and, on the last step, wraps back to the first. */
const HIGHLIGHT_INTERVAL_MS = 1600

const STEPS = [
  {
    title: 'Watch',
    body: '22 zones across seven IGAD countries, drawing on ACLED, CHIRPS, IPC, DTM, WFP and WHO data plus field reports.',
  },
  {
    title: 'Score',
    body: 'A model forecast and corroborating reports combine into pressure, by a rule recorded on every assessment.',
  },
  {
    title: 'Approve',
    body: 'A named person reviews every alert before anything is sent.',
  },
  {
    title: 'Act',
    body: 'Approved alerts reach people directly, by voice call.',
  },
]

/** Top-level blocks (header, intro, steps) settle in this order before the steps stagger their own entrance. */
const BLOCK_DELAY = { header: 0, intro: 0.08, steps: 0.16 }

/**
 * First screen a new operator sees: one wide panel, sized to its content —
 * no inner scroll. The four facts a briefing needs (what's watched, how it's
 * scored, who signs off, what happens next) read left to right as the
 * pipeline they actually are, not as a stack of unrelated definitions.
 */
export function WelcomeBento({
  onTakeLook,
  onSkip,
}: {
  onTakeLook: () => void
  onSkip: () => void
}) {
  const reduceMotion = useReducedMotion() ?? false
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)
  const isDark = theme === 'dark'

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-2xl">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: EASE.entrance }}
        className="flex w-full max-w-[900px] flex-col overflow-hidden rounded-bento border border-line bg-surface shadow-panel"
      >
        <div className="p-6 sm:p-8">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE.entrance, delay: BLOCK_DELAY.header }}
            className="flex flex-wrap items-start justify-between gap-4"
          >
            <div>
              <p className="text-eyebrow text-faint uppercase">Welcome to</p>
              <h1 className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl">
                  <BrandMark size={24} className="text-accent" />
                  Dira
                </span>
                <span className="text-xs font-semibold tracking-[0.08em] text-accent uppercase">
                  The Next Horizon
                </span>
              </h1>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={isDark}
              className="inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-full border border-line-strong bg-surface-2 px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-3 hover:-translate-y-px active:translate-y-0"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isDark ? 'sun' : 'moon'}
                  initial={reduceMotion ? false : { opacity: 0, rotate: -90, scale: 0.6 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, rotate: 90, scale: 0.6 }}
                  transition={{ duration: 0.18, ease: EASE.standard }}
                  className="flex"
                >
                  {isDark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
                </motion.span>
              </AnimatePresence>
              <span className="hidden sm:inline">{isDark ? 'Light mode' : 'Dark mode'}</span>
            </button>
          </motion.div>

          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE.entrance, delay: BLOCK_DELAY.intro }}
            className="mt-4 max-w-[64ch] text-md leading-relaxed text-muted"
          >
            A situation room for the Horn of Africa. Dira combines climate data, conflict history
            and local reporting into <strong className="font-semibold text-ink">pressure</strong> —
            one indicator for how close a zone is to armed conflict, displacement, or a food
            crisis in the weeks ahead.
          </motion.p>

          <StepSequence reduceMotion={reduceMotion} baseDelay={BLOCK_DELAY.steps} />
        </div>

        <footer className="shrink-0 border-t border-line bg-surface px-6 py-4 sm:px-8">
          <div className="flex flex-col-reverse items-stretch justify-end gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-medium text-muted transition-[colors,transform] hover:-translate-y-px hover:bg-surface-2 hover:text-ink active:translate-y-0"
            >
              Skip intro
            </button>
            <span className="hidden flex-1 sm:block" />
            <button
              type="button"
              onClick={onTakeLook}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-[colors,transform] hover:-translate-y-px hover:bg-accent-hover active:translate-y-0"
            >
              Start the tour <ArrowRight size={16} aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-2xs text-faint sm:text-right">Takes about 30 seconds.</p>
        </footer>
      </motion.div>
    </div>
  )
}

/**
 * Four steps, one pipeline. The connecting line draws itself in from the
 * left and each circle pops in behind it in sequence on mount; once settled,
 * a highlight walks forward through the steps on its own — step 1, then 2,
 * then 3, then 4, then back to 1 — so the sequence keeps reading as a cycle
 * rather than a static list, even for someone who never touches the panel.
 */
function StepSequence({ reduceMotion, baseDelay }: { reduceMotion: boolean; baseDelay: number }) {
  const [activeStep, setActiveStep] = useState(reduceMotion ? -1 : 0)

  useEffect(() => {
    if (reduceMotion) return
    const id = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % STEPS.length)
    }, HIGHLIGHT_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [reduceMotion])

  return (
    <ol className="relative mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 sm:gap-y-0">
      <motion.span
        aria-hidden
        initial={reduceMotion ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.5, ease: EASE.standard, delay: baseDelay }}
        style={{ transformOrigin: 'left' }}
        className="absolute top-4 right-[12.5%] left-[12.5%] hidden h-px bg-line sm:block"
      />
      {!reduceMotion ? (
        <motion.span
          aria-hidden
          animate={{ left: `${12.5 + activeStep * 25}%` }}
          transition={{ duration: (HIGHLIGHT_INTERVAL_MS / 1000) * 0.3, ease: EASE.standard }}
          className="absolute top-4 hidden size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_var(--color-accent-ring)] sm:block"
        />
      ) : null}
      {STEPS.map((step, index) => {
        const active = index === activeStep
        return (
          <motion.li
            key={step.title}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.3,
              ease: EASE.entrance,
              delay: baseDelay + 0.1 + staggerDelay(index),
            }}
            className="relative flex flex-col items-center px-1 text-center"
          >
            <motion.span
              animate={{ scale: active ? 1.12 : 1 }}
              transition={{ duration: 0.3, ease: EASE.standard }}
              className={cx(
                'flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-300',
                active
                  ? 'border-accent bg-accent text-white'
                  : 'border-line-strong bg-surface text-ink hover:border-accent hover:text-accent',
              )}
            >
              {index + 1}
            </motion.span>
            <p
              className={cx(
                'mt-2 text-xs font-semibold transition-colors duration-300',
                active ? 'text-accent' : 'text-ink',
              )}
            >
              {step.title}
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-muted">{step.body}</p>
          </motion.li>
        )
      })}
    </ol>
  )
}
