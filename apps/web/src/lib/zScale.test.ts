import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Tailwind v4 has no `--z-*` theme namespace. Declaring `--z-drawer: 45` in
 * `@theme` publishes the custom property but generates no `z-drawer` class, so
 * every named layer in the app was emitting nothing and the UI was stacking on
 * DOM order — MapLibre's controls painted over the advisor panel, which
 * believed it was at 45.
 *
 * The fix is an explicit `@utility` per token, which means there are now two
 * lists that have to agree, and a missing entry fails silently in exactly the
 * same way. Hence this test.
 */
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf-8')
const themeBlock = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

const tokens = [...themeBlock.matchAll(/--z-([\w-]+):\s*(\d+);/g)].map(
  ([, name, value]) => [name, Number(value)] as const,
)
const utilities = new Map(
  [...css.matchAll(/@utility\s+z-([\w-]+)\s*\{\s*z-index:\s*var\(--z-([\w-]+)\);\s*\}/g)].map(
    ([, name, ref]) => [name, ref],
  ),
)

describe('the z-index scale', () => {
  it('declares tokens at all', () => {
    expect(tokens.length).toBeGreaterThanOrEqual(8)
  })

  it.each(tokens)('--z-%s has a matching @utility', (name) => {
    expect(utilities.get(name), `missing: @utility z-${name}`).toBe(name)
  })

  it('has no @utility without a token', () => {
    const declared = new Set(tokens.map(([name]) => name))
    for (const name of utilities.keys()) {
      expect(declared.has(name), `@utility z-${name} has no --z-${name}`).toBe(true)
    }
  })

  it('orders the layers the way the UI depends on', () => {
    const value = Object.fromEntries(tokens)
    // The map's own chrome sits under the app's, which sits under overlays.
    expect(value['map-base']).toBeLessThan(value['map-ui'])
    expect(value['map-ui']).toBeLessThan(value['map-panel'])
    expect(value['map-panel']).toBeLessThan(value.header)
    // The advisor dock must clear MapLibre's controls, which ship at 2.
    expect(value.drawer).toBeGreaterThan(2)
    expect(value.header).toBeLessThanOrEqual(value.drawer)
    expect(value.drawer).toBeLessThan(value.modal)
    expect(value.modal).toBeLessThan(value.tour)
    expect(value.tour).toBeLessThan(value.tooltip)
  })
})
