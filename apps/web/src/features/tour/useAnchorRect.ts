import { useEffect, useState } from 'react'
import { inflate, measure, type Rect } from '../../lib/anchor'

const PADDING = 8

/**
 * Track the viewport rect of the element matching `selector` while `active`.
 *
 * Re-measures on element resize, window resize and scroll. Scroll is listened
 * to in the capture phase because the app scrolls inside `main`, not on
 * `window`, so a bubbling listener would never fire.
 *
 * The measurement is stored together with the selector it belongs to, and the
 * result is derived at render time. That way switching steps cannot briefly
 * report the previous anchor's rect, and the hook never has to call setState
 * synchronously inside the effect just to clear itself.
 */
export function useAnchorRect(selector: string | null, active: boolean): Rect | null {
  const [measured, setMeasured] = useState<{ selector: string; rect: Rect } | null>(null)

  useEffect(() => {
    if (!active || !selector) {
      return
    }

    const element = document.querySelector(selector)
    if (!element) {
      return
    }

    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = inflate(measure(element), PADDING)
        setMeasured((current) =>
          current &&
          current.selector === selector &&
          current.rect.top === rect.top &&
          current.rect.left === rect.left &&
          current.rect.width === rect.width &&
          current.rect.height === rect.height
            ? current
            : { selector, rect },
        )
      })
    }

    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(element)
    resizeObserver.observe(document.documentElement)

    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, { capture: true, passive: true })

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, { capture: true })
    }
  }, [active, selector])

  return active && selector && measured?.selector === selector ? measured.rect : null
}
