/**
 * Motion tokens, mirrored from the `--ease-*` values in index.css so that
 * `motion` props and CSS transitions never drift apart.
 *
 * House rules for this app (a situation room, not a toy):
 *  - Springs are for panels and the tour spotlight only. Anything that
 *    encodes data animates on a duration + ease, never with overshoot.
 *  - Never crossfade a numeric value or a band color.
 *  - Staggers are first-mount only, capped, and never on table rows.
 */
import type { Transition } from 'motion/react'

/** Cubic-bezier control points, matching the CSS custom properties. */
export const EASE = {
  standard: [0.2, 0, 0.38, 0.9],
  entrance: [0, 0, 0.38, 0.9],
  exit: [0.2, 0, 1, 0.9],
} as const

export const DURATION = {
  fast: 0.12,
  base: 0.18,
  slow: 0.3,
  deliberate: 0.4,
} as const

export const T = {
  fast: { duration: DURATION.fast, ease: EASE.standard },
  base: { duration: DURATION.base, ease: EASE.standard },
  slow: { duration: DURATION.slow, ease: EASE.standard },
  enter: { duration: DURATION.base, ease: EASE.entrance },
  exit: { duration: DURATION.fast, ease: EASE.exit },
  /** Drawers, sheets, and the map zone card. */
  panel: { type: 'spring', stiffness: 380, damping: 40, mass: 0.9 },
  /** The tour spotlight cutout — tighter, so it reads as precise. */
  spotlight: { type: 'spring', stiffness: 400, damping: 38, mass: 0.8 },
  /** Meters and counters: deliberate, never bouncy. */
  value: { duration: DURATION.deliberate, ease: EASE.standard },
} satisfies Record<string, Transition>

/** Route transition — kept small on purpose; the map route opts out entirely. */
export const ROUTE_TRANSITION = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -2 },
  transition: { duration: 0.14, ease: EASE.standard },
} as const

/** First-mount list stagger. Capped — see house rules above. */
export const STAGGER_STEP = 0.02
export const STAGGER_MAX_ITEMS = 6

export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX_ITEMS) * STAGGER_STEP
}

/** MapLibre `flyTo` duration. The zone card enters CARD_LAG_MS later so the
 *  two read as a single gesture. */
export const MAP_FLY_MS = 900
export const CARD_LAG_MS = 120
