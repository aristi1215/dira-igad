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
      className="modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={`modal-panel${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 className="modal-title">{title}</h2>
          </div>
          <button
            type="button"
            className="close-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="modal-body">{children}</div>
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
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  )
}
