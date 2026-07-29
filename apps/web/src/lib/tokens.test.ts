import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BAND_COLORS, BAND_MAP_COLORS, IPC_COLORS } from './format'

/**
 * The band and IPC palettes exist twice by necessity: once in `@theme` (which
 * Tailwind needs to generate utility classes) and once here in TypeScript
 * (which MapLibre paint expressions and recharts need as raw hex). Tailwind
 * cannot read the TS module and the TS module cannot read the CSS, so these
 * tests are what stop the two drifting apart.
 */
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf-8')

function themeToken(name: string): string | undefined {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8});`))
  return match?.[1]?.toLowerCase()
}

describe('design tokens match the JS palette', () => {
  it.each([
    ['color-band-low', BAND_COLORS.low],
    ['color-band-watch', BAND_COLORS.watch],
    ['color-band-elevated', BAND_COLORS.elevated],
    ['color-band-high', BAND_COLORS.high],
    ['color-band-very-high', BAND_COLORS.very_high],
    ['color-band-none', BAND_COLORS.none],
    ['color-band-ack', BAND_COLORS.ack],
  ])('%s matches BAND_COLORS', (token, expected) => {
    expect(themeToken(token)).toBe(expected.toLowerCase())
  })

  it('the lighter map variant of very-high is declared', () => {
    expect(themeToken('color-band-very-high-map')).toBe(
      BAND_MAP_COLORS.very_high.toLowerCase(),
    )
  })

  it.each([1, 2, 3, 4, 5])('IPC phase %i matches IPC_COLORS', (phase) => {
    expect(themeToken(`color-ipc-${phase}`)).toBe(IPC_COLORS[phase].toLowerCase())
  })

  it('keeps Tailwind layered below the vendor and legacy stylesheets', () => {
    // Layer order is what stops maplibre-gl.css beating Tailwind utilities and
    // collapsing the map container — see the note in index.css.
    expect(css).toMatch(/@layer theme, base, vendor, components, utilities;/)
    expect(css).toMatch(/@import 'maplibre-gl\/dist\/maplibre-gl\.css' layer\(vendor\);/)
  })
})
