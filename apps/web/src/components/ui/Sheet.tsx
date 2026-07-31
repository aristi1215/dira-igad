import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { T } from '../../lib/motion'
import { IconButton } from './Button'

/**
 * Right-edge drawer.
 *
 * Two modes, because two different things want a drawer. The default is modal:
 * a veil over the page, focus trapped, click-outside to close — the right shape
 * for a form you must finish or abandon.
 *
 * `overlay="none"` with `modal={false}` is the other: a panel that reads *about*
 * what is still on screen. The map uses it, where veiling and trapping would be
 * the bug — you look at a zone card precisely in order to keep panning, and a
 * focus trap over a map means Tab can never reach the map again. Dismissal
 * there is the close button, Escape, and clicking the map itself.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  width = '26rem',
  overlay = 'veil',
  modal = true,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  width?: string
  /** `none` leaves whatever is behind fully visible and interactive. */
  overlay?: 'veil' | 'none'
  /** Focus trap + `aria-modal`. Turn off for a panel that annotates the page. */
  modal?: boolean
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, open && modal, onClose)

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          {overlay === 'veil' ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={T.fast}
              onClick={onClose}
              aria-hidden
              className="fixed inset-0 z-drawer bg-surface/25"
            />
          ) : null}
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal={modal}
            aria-label={title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={T.panel}
            style={{ width: `min(${width}, 94vw)` }}
            className="fixed inset-y-0 right-0 z-drawer flex flex-col rounded-l-bento border border-line bg-surface/95 shadow-panel"
          >
            <header className="flex items-start justify-between gap-3 px-5 py-4">
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
