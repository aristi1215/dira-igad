/**
 * Resolve once an element matching `selector` is in the DOM and has a size.
 *
 * Steps navigate between routes, and the chart-heavy screens are code-split, so
 * an anchor can be several hundred milliseconds away. A MutationObserver
 * catches the mount; the rAF check covers the case where it mounts with zero
 * size and lays out a frame later.
 *
 * Resolves `null` on timeout — callers advance rather than dead-end.
 */
export function waitForAnchor(selector: string, timeoutMs = 2500): Promise<Element | null> {
  const existing = document.querySelector(selector)
  if (existing && hasSize(existing)) {
    return Promise.resolve(existing)
  }

  return new Promise((resolve) => {
    let settled = false
    let frame = 0

    const finish = (element: Element | null) => {
      if (settled) return
      settled = true
      observer.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      resolve(element)
    }

    const check = () => {
      const element = document.querySelector(selector)
      if (element && hasSize(element)) {
        finish(element)
      } else {
        frame = requestAnimationFrame(check)
      }
    }

    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })

    const timer = setTimeout(() => finish(null), timeoutMs)
    frame = requestAnimationFrame(check)
  })
}

function hasSize(element: Element): boolean {
  const box = element.getBoundingClientRect()
  return box.width > 0 && box.height > 0
}
