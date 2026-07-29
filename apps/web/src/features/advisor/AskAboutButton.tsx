import { Sparkles } from 'lucide-react'
import { cx } from '../../lib/cx'
import { useAdvisorStore } from './advisorStore'

/**
 * "Explain this" for the block it sits in.
 *
 * Deliberately near-invisible: it fades in on hover or keyboard focus of the
 * surrounding element (which must carry Tailwind's `group`), so the advisor is
 * one click away from any panel without any of them acquiring a permanent
 * badge. An assistant that advertises itself on every card stops being an
 * affordance and becomes clutter.
 *
 * Always focusable, so it is reachable by keyboard even though it is visually
 * hidden until hover.
 */
export function AskAboutButton({
  question,
  label = 'Ask Dira about this',
  className,
}: {
  /** The exact question to send. Write it as a person would ask it. */
  question: string
  label?: string
  className?: string
}) {
  const askAbout = useAdvisorStore((state) => state.askAbout)

  return (
    <button
      type="button"
      onClick={() => askAbout(question)}
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-faint',
        'opacity-0 transition-[opacity,color,background-color] duration-[140ms] ease-standard',
        'group-hover:opacity-100 focus-visible:opacity-100',
        'hover:bg-accent-soft hover:text-accent',
        className,
      )}
    >
      <Sparkles size={14} strokeWidth={1.75} aria-hidden />
    </button>
  )
}
