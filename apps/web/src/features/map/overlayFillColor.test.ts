import { describe, expect, it } from 'vitest'
import { overlayFillColor } from './useMapLayers'
import { BAND_MAP_COLORS, CHART, IPC_COLORS } from '../../lib/format'
import type { MapOverlay } from '../../lib/types'

/**
 * The choropleth is the map's whole message, and a wrong property name in a
 * paint expression fails silently — every zone just renders in the fallback
 * grey. These assertions pin each overlay to the field it is supposed to read.
 */
const OVERLAYS: MapOverlay[] = ['pressure', 'ipc', 'displacement', 'incidents', 'hazards']

function flatten(expression: unknown): string {
  return JSON.stringify(expression)
}

describe('overlayFillColor', () => {
  it('returns an expression for every overlay', () => {
    for (const overlay of OVERLAYS) {
      expect(overlayFillColor(overlay), `no expression for ${overlay}`).toBeTruthy()
    }
  })

  it.each([
    ['pressure', 'operational_band'],
    ['ipc', 'ipc_phase'],
    ['displacement', 'idps'],
    ['incidents', 'incidents_180d'],
    ['hazards', 'active_hazards'],
  ] as const)('%s reads the %s property', (overlay, property) => {
    expect(flatten(overlayFillColor(overlay))).toContain(property)
  })

  it('covers all five bands plus a no-data fallback', () => {
    const pressure = flatten(overlayFillColor('pressure'))
    for (const band of ['low', 'watch', 'elevated', 'high', 'very_high'] as const) {
      expect(pressure, `band ${band} missing`).toContain(band)
      expect(pressure, `color for ${band} missing`).toContain(BAND_MAP_COLORS[band])
    }
    // Zones without an assessment must still render, in grey rather than a band color.
    expect(pressure).toContain('#e0e0e0')
  })

  it('uses the official IPC phase colors, not the band palette', () => {
    const ipc = flatten(overlayFillColor('ipc'))
    for (const phase of [1, 2, 3, 4, 5]) {
      expect(ipc).toContain(IPC_COLORS[phase])
    }
    expect(ipc).not.toContain(BAND_MAP_COLORS.high)
  })

  it('uses the sequential blue ramp for the count overlays', () => {
    for (const overlay of ['displacement', 'incidents', 'hazards'] as const) {
      const expression = flatten(overlayFillColor(overlay))
      expect(expression, `${overlay} should start at the palest blue`).toContain(CHART.blues[0])
      expect(expression, `${overlay} should end at the darkest blue`).toContain(CHART.blues[6])
    }
  })

  it('coalesces missing values so a null never breaks the ramp', () => {
    for (const overlay of OVERLAYS) {
      expect(flatten(overlayFillColor(overlay))).toContain('coalesce')
    }
  })
})
