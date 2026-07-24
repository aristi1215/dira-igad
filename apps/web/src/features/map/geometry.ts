import type { Feature, Geometry } from 'geojson'

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
