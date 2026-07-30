import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )
}

/**
 * Trap Tab focus inside `ref` while `active`, moving focus in on activation
 * and restoring it to the previously focused element on teardown.
 *
 * Used by Modal (which trapped nothing before) and the tour coach-mark.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
): void {
  // Hold the latest onEscape in a ref so a caller passing a fresh closure each
  // render does not re-run the effect below — re-running it steals focus back
  // to the first control on every keystroke, dropping input in modal fields.
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    const container = ref.current
    if (!active || !container) {
      return
    }

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus the first control, or the container itself if it has none.
    const initial = focusableWithin(container)[0] ?? container
    if (initial === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1')
    }
    initial.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.stopPropagation()
        onEscapeRef.current()
        return
      }
      if (event.key !== 'Tab') {
        return
      }

      const focusable = focusableWithin(container)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey && (activeElement === first || activeElement === container)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [active, ref])
}
