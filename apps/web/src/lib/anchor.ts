/**
 * Positioning helpers shared by Tooltip, the map hover card, and the tour
 * coach-mark. Deliberately dependency-free — these three cases only need
 * "place a box beside a rect, flip if it doesn't fit, clamp to the viewport",
 * which is a fraction of what a full floating-ui integration would cost.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left'

export type Rect = {
  top: number
  left: number
  width: number
  height: number
}

export type Size = {
  width: number
  height: number
}

export type Placement = {
  top: number
  left: number
  /** The side actually used, after any flip — callers point their arrow with it. */
  side: Side
}

const VIEWPORT_MARGIN = 8

export function measure(element: Element): Rect {
  const box = element.getBoundingClientRect()
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

/** Grow a rect equally on all sides (the tour spotlight pads its cutout). */
export function inflate(rect: Rect, by: number): Rect {
  return {
    top: rect.top - by,
    left: rect.left - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  }
}

function fits(side: Side, anchor: Rect, size: Size, gap: number): boolean {
  switch (side) {
    case 'top':
      return anchor.top - gap - size.height >= VIEWPORT_MARGIN
    case 'bottom':
      return anchor.top + anchor.height + gap + size.height <= window.innerHeight - VIEWPORT_MARGIN
    case 'left':
      return anchor.left - gap - size.width >= VIEWPORT_MARGIN
    case 'right':
      return anchor.left + anchor.width + gap + size.width <= window.innerWidth - VIEWPORT_MARGIN
  }
}

const FALLBACK_ORDER: Record<Side, Side[]> = {
  top: ['top', 'bottom', 'right', 'left'],
  bottom: ['bottom', 'top', 'right', 'left'],
  left: ['left', 'right', 'bottom', 'top'],
  right: ['right', 'left', 'bottom', 'top'],
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Place a floating box of `size` beside `anchor`, preferring `preferred` and
 * flipping through the fallback order until one fits. The result is always
 * clamped into the viewport, so a box that fits nowhere still lands on screen
 * rather than half off it.
 *
 * Coordinates are viewport-relative — render into a `position: fixed` element.
 */
export function placeBeside(
  anchor: Rect,
  size: Size,
  preferred: Side = 'bottom',
  gap = 10,
): Placement {
  const side = FALLBACK_ORDER[preferred].find((candidate) => fits(candidate, anchor, size, gap))
    ?? preferred

  let top: number
  let left: number

  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? anchor.top - gap - size.height : anchor.top + anchor.height + gap
    left = anchor.left + anchor.width / 2 - size.width / 2
  } else {
    left = side === 'left' ? anchor.left - gap - size.width : anchor.left + anchor.width + gap
    top = anchor.top + anchor.height / 2 - size.height / 2
  }

  return {
    side,
    top: clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerHeight - size.height - VIEWPORT_MARGIN)),
    left: clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, window.innerWidth - size.width - VIEWPORT_MARGIN)),
  }
}

/** Place a box near a bare point — used by the map hover card, which follows
 *  the cursor rather than an element. */
export function placeNearPoint(
  point: { x: number; y: number },
  size: Size,
  offset = 14,
): Placement {
  const anchor: Rect = { top: point.y, left: point.x, width: 0, height: 0 }
  const preferred: Side = point.x + offset + size.width > window.innerWidth - VIEWPORT_MARGIN
    ? 'left'
    : 'right'
  return placeBeside(anchor, size, preferred, offset)
}
