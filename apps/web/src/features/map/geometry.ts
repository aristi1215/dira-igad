import type { Feature, Geometry } from 'geojson'
import type { MapEvents } from '../../lib/types'

/**
 * Where a zone's marker should actually sit.
 *
 * The bbox centre puts every marker in the dead middle of its rectangle, which
 * is both the least informative point available and the reason the old map
 * read as "a square with a dot in it". Weighting by recorded conflict events
 * — fatalities first, then event count — pulls the marker onto the part of the
 * zone the reading is actually about.
 *
 * Zones with no events fall back to the bbox centre, which is the honest
 * answer when there is nothing to weight by.
 */
export function eventWeightedAnchors(
  events: MapEvents | undefined,
): globalThis.Map<string, [number, number]> {
  const sums = new globalThis.Map<
    string,
    { lon: number; lat: number; weight: number }
  >()

  for (const feature of events?.features ?? []) {
    const geometry = feature.geometry
    if (geometry?.type !== 'Point') continue
    const [lon, lat] = geometry.coordinates as [number, number]
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

    const zoneId = feature.properties?.zone_id
    if (typeof zoneId !== 'string') continue

    // +1 so a non-fatal event still counts for something: "an incident
    // happened here" is information even when nobody died.
    const weight = (feature.properties?.fatalities ?? 0) + 1
    const current = sums.get(zoneId) ?? { lon: 0, lat: 0, weight: 0 }
    current.lon += lon * weight
    current.lat += lat * weight
    current.weight += weight
    sums.set(zoneId, current)
  }

  const anchors = new globalThis.Map<string, [number, number]>()
  for (const [zoneId, sum] of sums) {
    if (sum.weight > 0) {
      anchors.set(zoneId, [sum.lon / sum.weight, sum.lat / sum.weight])
    }
  }
  return anchors
}

export function featureCenter(
  feature: Feature<Geometry, unknown>,
): [number, number] | null {
  const positions = flattenGeometry(feature.geometry)
  if (positions.length === 0) {
    return null
  }

  const bounds = positions.reduce(
    (current, [longitude, latitude]) => ({
      west: Math.min(current.west, longitude),
      east: Math.max(current.east, longitude),
      south: Math.min(current.south, latitude),
      north: Math.max(current.north, latitude),
    }),
    {
      west: Number.POSITIVE_INFINITY,
      east: Number.NEGATIVE_INFINITY,
      south: Number.POSITIVE_INFINITY,
      north: Number.NEGATIVE_INFINITY,
    },
  )

  return [
    (bounds.west + bounds.east) / 2,
    (bounds.south + bounds.north) / 2,
  ]
}

function flattenGeometry(geometry: Geometry): [number, number][] {
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap((item) => flattenGeometry(item))
  }

  return flattenPositions(geometry.coordinates)
}

function flattenPositions(value: unknown): [number, number][] {
  if (isPosition(value)) {
    return [[value[0], value[1]]]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenPositions(item))
  }

  return []
}

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  )
}
