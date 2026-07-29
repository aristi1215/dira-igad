import { describe, expect, it } from 'vitest'
import { eventWeightedAnchors, featureCenter } from './geometry'
import type { MapEvents } from '../../lib/types'

function events(
  rows: { zone: string | null; lon: number; lat: number; fatalities?: number }[],
): MapEvents {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
      properties: { zone_id: row.zone, fatalities: row.fatalities ?? 0 },
    })),
  } as MapEvents
}

/*
 * Every zone geometry in this dataset is an axis-aligned rectangle, so the
 * bbox centre — the old marker position — is both the least informative point
 * available and the reason the map read as a grid of squares with dots in
 * them. These assertions pin the behaviour that fixed it.
 */
describe('eventWeightedAnchors', () => {
  it('pulls the anchor toward where the violence actually is', () => {
    // A zone spanning 0..10 in both axes, with every event clustered bottom-left.
    const anchors = eventWeightedAnchors(
      events([
        { zone: 'z', lon: 1, lat: 1 },
        { zone: 'z', lon: 2, lat: 1 },
        { zone: 'z', lon: 1, lat: 2 },
      ]),
    )
    const [lon, lat] = anchors.get('z')!
    expect(lon).toBeLessThan(5)
    expect(lat).toBeLessThan(5)
  })

  it('weights by fatalities, not just event count', () => {
    const anchors = eventWeightedAnchors(
      events([
        { zone: 'z', lon: 0, lat: 0, fatalities: 0 },
        { zone: 'z', lon: 0, lat: 0, fatalities: 0 },
        { zone: 'z', lon: 10, lat: 0, fatalities: 40 },
      ]),
    )
    const [lon] = anchors.get('z')!
    // Two non-fatal events cannot outvote one with forty deaths.
    expect(lon).toBeGreaterThan(5)
  })

  it('still counts a non-fatal event — an incident is information', () => {
    const anchors = eventWeightedAnchors(
      events([
        { zone: 'z', lon: 0, lat: 0, fatalities: 0 },
        { zone: 'z', lon: 10, lat: 0, fatalities: 0 },
      ]),
    )
    expect(anchors.get('z')![0]).toBeCloseTo(5)
  })

  it('ignores events with no zone', () => {
    // Most recorded violence in the region falls outside the 22 assessed
    // zones. It belongs in the heat field but must not move any anchor.
    const anchors = eventWeightedAnchors(events([{ zone: null, lon: 3, lat: 3 }]))
    expect(anchors.size).toBe(0)
  })

  it('produces no anchor for a zone with no events, so the caller falls back', () => {
    const anchors = eventWeightedAnchors(events([{ zone: 'a', lon: 1, lat: 1 }]))
    expect(anchors.has('b')).toBe(false)
  })

  it('survives an undefined feed', () => {
    expect(eventWeightedAnchors(undefined).size).toBe(0)
  })
})

describe('featureCenter', () => {
  it('is the bbox centre — the documented fallback when a zone has no events', () => {
    const center = featureCenter({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 4],
            [0, 4],
            [0, 0],
          ],
        ],
      },
    })
    expect(center).toEqual([5, 2])
  })
})
