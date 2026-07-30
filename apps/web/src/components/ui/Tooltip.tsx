import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { HelpCircle } from 'lucide-react'
import { measure, placeBeside, type Placement, type Side } from '../../lib/anchor'
import { T } from '../../lib/motion'
import { cx } from '../../lib/cx'

/**
 * Hover/focus tooltip. Portaled so it is never clipped by a card's overflow,
 * and positioned with lib/anchor.ts (shared with the map hover card and the
 * tour coach-mark).
 */
export function Tooltip({
  content,
  side = 'top',
  children,
  className,
}: {
  content: ReactNode
  side?: Side
  children: ReactNode
  className?: string
}) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) {
      return
    }
    const anchor = measure(triggerRef.current)
    const panel = panelRef.current.getBoundingClientRect()
    setPlacement(placeBeside(anchor, { width: panel.width, height: panel.height }, side, 8))
  }, [open, side])

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        className={cx('inline-flex cursor-help items-center', className)}
      >
        {children}
      </span>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panelRef}
              id={id}
              role="tooltip"
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 2 }}
              transition={T.fast}
              style={{
                top: placement?.top ?? -9999,
                left: placement?.left ?? -9999,
                visibility: placement ? 'visible' : 'hidden',
              }}
              className="pointer-events-none fixed z-tooltip max-w-[22rem] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-muted shadow-panel"
            >
              {content}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

/** Standard "what does this mean?" affordance next to a label. */
export function InfoHint({ content, className }: { content: ReactNode; className?: string }) {
  return (
    <Tooltip content={content} className={className}>
      <HelpCircle
        size={13}
        strokeWidth={1.75}
        aria-label="More information"
        className="text-faint transition-colors duration-[120ms] hover:text-accent"
      />
    </Tooltip>
  )
}
