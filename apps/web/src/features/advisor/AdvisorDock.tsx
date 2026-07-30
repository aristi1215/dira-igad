import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Maximize2, Minimize2, Sparkles, X } from 'lucide-react'
import { IconButton } from '../../components/ui'
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
  const [expanded, setExpanded] = useAdvisorDockSize()

  return (
    <div className="pointer-events-none fixed inset-0 z-drawer">
      <AnimatePresence initial={false} mode="popLayout">
        {!open ? (
          <motion.button
            key="advisor-fab"
            type="button"
            layoutId="advisor-dock"
            onClick={toggleAdvisor}
            className={`pointer-events-auto fixed bottom-4 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:-translate-y-px ${
              mapRoute ? 'right-[28rem]' : 'right-4'
            }`}
            aria-label="Ask Dira"
          >
            <Sparkles size={16} aria-hidden />
            Ask Dira
          </motion.button>
        ) : (
          <motion.aside
            key="advisor-panel"
            layoutId="advisor-dock"
            role="dialog"
            aria-modal="true"
            aria-label="Ask Dira"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={`pointer-events-auto fixed bottom-4 top-20 flex flex-col overflow-hidden rounded-bento border border-line bg-surface/92 backdrop-blur-xl shadow-lg ${
              expanded ? 'w-[44rem]' : 'w-[26rem]'
            } ${mapRoute ? 'right-[28rem]' : 'right-4'}`}
            style={{ maxWidth: 'calc(100vw - 2rem)' }}
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

function useAdvisorDockSize() {
  const [expanded, setExpanded] = useState(false)
  return [expanded, setExpanded] as const
}
