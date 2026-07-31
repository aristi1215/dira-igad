import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Maximize2, Minimize2, Sparkles, X } from 'lucide-react'
import { IconButton } from '../../components/ui'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { T } from '../../lib/motion'
import { useAdvisorStore } from './advisorStore'
import { AskAdvisor } from './AskAdvisor'
import type { ZoneSummary } from '../../lib/types'

export function AdvisorDock({
  situationId,
  zone,
  mapRoute,
}: {
  situationId: string | null
  zone?: ZoneSummary | null
  mapRoute: boolean
}) {
  const open = useAdvisorStore((state) => state.open)
  const closeAdvisor = useAdvisorStore((state) => state.closeAdvisor)
  const toggleAdvisor = useAdvisorStore((state) => state.toggleAdvisor)
  const [expanded, setExpanded] = useState(false)
  const reducedMotion = useReducedMotion()
  const panelRef = useRef<HTMLElement | null>(null)
  useFocusTrap(panelRef, open, closeAdvisor)

  /*
   * On the map route the dock shares the viewport with three fixed panels: the
   * watchlist rail down the left, the zone card top-right, and the status strip
   * across the bottom. It used to dodge them with `right-[28rem]`, a fixed
   * 448px offset that put the button on top of the status strip and, once
   * expanded to 44rem, over the rail on any viewport below ~1476px — including
   * the 1280 laptop the rail itself was tuned for.
   *
   * Lifting it clear of the strip instead keeps it in the corner where a FAB
   * belongs, and capping the panel against the rail's own width means the two
   * cannot overlap at any viewport size.
   */
  const anchor = mapRoute ? 'right-4 bottom-[4.5rem]' : 'right-4 bottom-4'
  const maxWidth = mapRoute ? 'calc(100vw - 21.5rem)' : 'calc(100vw - 2rem)'

  // The panel collapses toward the bottom-right corner the FAB reoccupies,
  // rather than a generic fade — the two no longer share a `layoutId`
  // (that shared morph from a ~700px panel down to a pill was the jank), so
  // this transform-origin is what keeps the close feel connected to the
  // button underneath it.
  const panelMotion = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.94, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.94, y: 12, transition: T.exit },
      }
  const fabMotion = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.8 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.8 },
      }

  return (
    <div className="pointer-events-none fixed inset-0 z-drawer">
      <AnimatePresence initial={false}>
        {!open ? (
          <motion.button
            key="advisor-fab"
            type="button"
            onClick={toggleAdvisor}
            {...fabMotion}
            transition={T.base}
            className={`pointer-events-auto fixed inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:-translate-y-px ${anchor}`}
            aria-label="Ask Dira"
          >
            <Sparkles size={16} aria-hidden />
            Ask Dira
          </motion.button>
        ) : (
          <motion.aside
            key="advisor-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Ask Dira"
            {...panelMotion}
            transition={T.panel}
            className={`pointer-events-auto fixed top-20 flex flex-col overflow-hidden rounded-bento border border-line bg-surface/92 shadow-lg backdrop-blur-xl ${
              expanded ? 'w-[44rem]' : 'w-[26rem]'
            } ${anchor}`}
            style={{ maxWidth, transformOrigin: '100% 100%' }}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Ask Dira</h2>
                <p className="mt-0.5 text-xs text-faint">
                  Grounded suggestions only — you decide what to approve or dispatch.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  icon={expanded ? Minimize2 : Maximize2}
                  label={expanded ? 'Collapse advisor' : 'Expand advisor'}
                  size="sm"
                  onClick={() => setExpanded((value) => !value)}
                />
                <IconButton icon={X} label="Close" size="sm" onClick={closeAdvisor} />
              </div>
            </header>
            <div className="min-h-0 flex-1">
              <AskAdvisor situationId={situationId} zone={zone} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}
