import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_ANCHORS } from './tourAnchors'

/**
 * The tour finds its targets with `[data-tour="…"]`, which is why it survives
 * route changes without prop drilling — but a deleted attribute would fail
 * silently, skipping the step rather than throwing. These tests are the guard.
 */
const SRC = fileURLToPath(new URL('../..', import.meta.url))

function readAllSource(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      readAllSource(full, acc)
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(readFileSync(full, 'utf-8'))
    }
  }
  return acc
}

const sources = readAllSource(SRC).join('\n')

/** Routes declared in App.tsx, so a step cannot point at a route that is gone. */
const ROUTES = ['/', '/situations', '/zones', '/dispatch', '/analytics', '/model', '/sources']

describe('guided tour steps', () => {
  it('every step anchors to a declared constant', () => {
    const declared = new Set<string>(Object.values(TOUR_ANCHORS))
    for (const step of TOUR_STEPS) {
      expect(
        declared.has(step.anchor),
        `step "${step.id}" uses an anchor that is not in TOUR_ANCHORS`,
      ).toBe(true)
    }
  })

  it('every anchor a step points at is rendered as a data-tour attribute', () => {
    const keyByValue = new Map(
      Object.entries(TOUR_ANCHORS).map(([key, value]) => [value as string, key]),
    )
    for (const step of TOUR_STEPS) {
      const key = keyByValue.get(step.anchor)
      // The attribute is always written as data-tour={TOUR_ANCHORS.<key>} so a
      // renamed or deleted anchor shows up here rather than as a skipped step.
      expect(
        sources.includes(`data-tour={TOUR_ANCHORS.${key}}`),
        `anchor "${step.anchor}" (step "${step.id}") is never rendered in JSX`,
      ).toBe(true)
    }
  })

  it('static routes exist in the router', () => {
    for (const step of TOUR_STEPS) {
      if (!step.route) continue
      expect(ROUTES, `step "${step.id}" targets an unknown route`).toContain(step.route)
    }
  })

  it('dynamic routes resolve to a real route prefix', () => {
    const context = { topZoneId: 'zone-1', topSituationId: 'sit-1' }
    for (const step of TOUR_STEPS) {
      if (!step.resolveRoute) continue
      const route = step.resolveRoute(context)
      expect(route, `step "${step.id}" resolved nothing for a populated context`).toBeTruthy()
      expect(ROUTES.some((base) => route!.startsWith(base === '/' ? '/' : base))).toBe(true)
    }
  })

  it('degrades to skipping a step when there is no situation to point at', () => {
    const empty = { topZoneId: null, topSituationId: null }
    for (const step of TOUR_STEPS) {
      expect(() => step.resolveRoute?.(empty)).not.toThrow()
      expect(() => step.precondition?.(empty)).not.toThrow()
    }
  })

  it('has unique step ids', () => {
    const ids = TOUR_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
