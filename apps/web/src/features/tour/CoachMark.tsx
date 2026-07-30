import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { placeBeside, type Placement, type Rect } from '../../lib/anchor'
import { Button } from '../../components/ui'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { cx } from '../../lib/cx'
import { T } from '../../lib/motion'
import type { TourStep } from './tourSteps'

const WIDTH = 320

export function CoachMark({
  step,
  index,
  total,
  rect,
  reduceMotion,
  onNext,
  onBack,
  onSkip,
  onJump,
}: {
  step: TourStep
  index: number
  total: number
  rect: Rect | null
  reduceMotion: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onJump: (index: number) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  useFocusTrap(panelRef, true, onSkip)

  useLayoutEffect(() => {
    if (!panelRef.current) return
    const height = panelRef.current.offsetHeight
    if (!rect) {
      setPlacement({
        side: 'bottom',
        top: window.innerHeight / 2 - height / 2,
        left: window.innerWidth / 2 - WIDTH / 2,
      })
      return
    }
    setPlacement(placeBeside(rect, { width: WIDTH, height }, step.side ?? 'bottom', 14))
  }, [rect, step.side, step.id])

  const isLast = index === total - 1

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Guided tour, step ${index + 1} of ${total}`}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : T.fast}
      style={{
        width: WIDTH,
        top: placement?.top ?? -9999,
        left: placement?.left ?? -9999,
        visibility: placement ? 'visible' : 'hidden',
      }}
      className="fixed z-tour min-w-[320px] rounded-bento border border-line bg-surface p-5 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-eyebrow text-accent">
          {step.chapter}
        </span>
        <span className="text-2xs text-faint tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      <h2 className="text-xl leading-snug font-semibold tracking-[-0.02em] text-ink">{step.title}</h2>
      <p className="mt-2 text-md leading-relaxed text-muted">{step.body}</p>

      {step.interactive ? (
        <p className="mt-2 text-2xs text-accent">You can click it — the tour will wait.</p>
      ) : null}

      {/* Progress rail doubles as a way back to any step already seen. */}
      <div className="mt-4 mb-3 flex gap-1" role="tablist" aria-label="Tour progress">
        {Array.from({ length: total }, (_, position) => (
          <button
            key={position}
            type="button"
            role="tab"
            aria-selected={position === index}
            aria-label={`Step ${position + 1}`}
            disabled={position > index}
            onClick={() => onJump(position)}
            className={cx(
              'h-1 flex-1 rounded-full transition-colors duration-[160ms]',
              position <= index ? 'bg-accent' : 'bg-line',
              position < index && 'cursor-pointer hover:bg-accent-hover',
              position > index && 'cursor-default',
            )}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip} icon={X}>
          Skip
        </Button>
        <span className="flex-1" />
        {index > 0 ? (
          <Button size="sm" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
        ) : null}
        <Button variant="primary" size="sm" iconRight={isLast ? undefined : ArrowRight} onClick={onNext}>
          {isLast ? 'Start exploring' : 'Next'}
        </Button>
      </div>
    </motion.div>
  )
}
