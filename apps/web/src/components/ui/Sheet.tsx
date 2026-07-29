import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { T } from '../../lib/motion'
import { IconButton } from './Button'

/** Right-edge drawer. Replaces the hand-positioned advisor aside. */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  width = '26rem',
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  width?: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, open, onClose)

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={T.fast}
            onClick={onClose}
            aria-hidden
            className="fixed inset-0 z-drawer bg-ink/25"
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={T.panel}
            style={{ width: `min(${width}, 94vw)` }}
            className="fixed inset-y-0 right-0 z-drawer flex flex-col border-l border-line bg-surface shadow-lg"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-md font-semibold text-ink">{title}</h2>
                {subtitle ? <p className="mt-0.5 text-xs text-faint">{subtitle}</p> : null}
              </div>
              <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
