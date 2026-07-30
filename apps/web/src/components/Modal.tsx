import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Keeps Tab inside the dialog, moves focus in, and restores it on close.
  // Escape is handled by the trap too.
  useFocusTrap(panelRef, true, onClose)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-surface/45 p-6 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`flex max-h-[min(84vh,900px)] w-[min(560px,100%)] flex-col overflow-hidden rounded-bento border border-line bg-surface shadow-lg outline-none${wide ? ' max-w-[720px]' : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-4 pb-3">
          <div>
            {eyebrow ? <p className="text-eyebrow text-accent">{eyebrow}</p> : null}
            <h2 className="mt-0.5 text-lg leading-snug font-semibold text-ink">{title}</h2>
          </div>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="grid gap-3.5 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Definition-list style row used inside detail modals. */
export function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-0.5 rounded-md border border-line bg-surface-2 px-2.5 py-2">
      <span className="text-eyebrow text-faint">{label}</span>
      <span className="break-words text-sm text-ink">{children}</span>
    </div>
  )
}
