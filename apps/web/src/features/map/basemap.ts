import type { Map, LayerSpecification, StyleSpecification } from 'maplibre-gl'

/**
 * Basemap styling.
 *
 * The map used flat CARTO raster tiles, which pixelate on zoom and bury their
 * labels under our choropleth. We now load CARTO's key-less *vector* Positron
 * style and tune it in place: strip competing detail, mute the palette so the
 * data carries the color, and keep place labels above our fills.
 *
 * Every tune is matched by layer-id prefix and guarded, so a CARTO style
 * update degrades to "no tuning" rather than a crash.
 */
export const VECTOR_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

/** Layer id prefixes to hide — detail that competes with the data. */
const HIDDEN_PREFIXES = [
  'poi',
  'building',
  'rail',
  'airport',
  'aeroway',
  'boundary_county',
  'waterway_tunnel',
  'tunnel',
  'bridge',
]

/**
 * Raster fallback, kept from the original implementation. If the vector style
 * fails to load (offline, blocked CDN) the map falls back to this rather than
 * rendering a blank canvas.
 */
export function rasterFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [{ id: 'carto-base', type: 'raster', source: 'carto' }],
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  }
}

/**
 * Id of the first symbol layer. Data layers are inserted *before* it so
 * basemap place labels render on top of the choropleth instead of under it —
 * this is what actually keeps names legible over a filled polygon.
 */
export function firstSymbolLayerId(map: Map): string | undefined {
  try {
    return map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
  } catch {
    return undefined
  }
}

/**
 * Read a font stack the loaded style is known to have glyphs for, rather than
 * hardcoding one — a missing fontstack renders labels invisibly.
 *
 * Upright fonts are preferred: the first symbol layer in CARTO Positron is
 * `waterway_label`, whose italic face made every zone name render in italics.
 */
export function fontStack(map: Map): string[] {
  const candidates: string[][] = []
  try {
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.type !== 'symbol') continue
      const font = (layer.layout as { 'text-font'?: string[] } | undefined)?.['text-font']
      if (Array.isArray(font) && font.length > 0) {
        candidates.push(font)
      }
    }
  } catch {
    // fall through to the default below
  }

  const upright = candidates.find(
    (font) => !font.some((name) => /italic|oblique/i.test(name)),
  )
  return upright ?? candidates[0] ?? ['Open Sans Regular', 'Arial Unicode MS Regular']
}

function setPaintIfPresent(
  map: Map,
  layerId: string,
  property: string,
  value: unknown,
): void {
  try {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, property, value)
    }
  } catch {
    // A style that lacks this property is fine — skip it.
  }
}

/** Desaturate and simplify the basemap so the data carries the color. */
export function tuneBasemap(map: Map): void {
  let layers: LayerSpecification[]
  try {
    layers = (map.getStyle().layers ?? []) as LayerSpecification[]
  } catch {
    return
  }

  for (const layer of layers) {
    const id = layer.id

    if (HIDDEN_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      try {
        map.setLayoutProperty(id, 'visibility', 'none')
      } catch {
        // ignore
      }
      continue
    }

    if (layer.type === 'background') {
      setPaintIfPresent(map, id, 'background-color', '#fafafa')
      continue
    }

    // Water reads as a neutral tone rather than blue, so the blue sequential
    // ramps used by the displacement/incidents overlays stay unambiguous.
    if (id.startsWith('water') && layer.type === 'fill') {
      setPaintIfPresent(map, id, 'fill-color', '#eef1f3')
      continue
    }

    // Roads are context, not content. With a heat field on top of them they
    // were the busiest thing on the canvas at continental zoom, so they fade
    // in only once someone has zoomed to where a road is a real landmark.
    if ((id.startsWith('road') || id.startsWith('highway') || id.startsWith('motorway'))
        && layer.type === 'line') {
      setPaintIfPresent(map, id, 'line-opacity', [
        'interpolate', ['linear'], ['zoom'],
        4, 0,
        6.5, 0.25,
        9, 0.6,
      ])
      continue
    }

    // Country borders orient the viewer — seven countries is part of the
    // story — so they are strengthened rather than muted.
    if (id.includes('boundary') && layer.type === 'line') {
      setPaintIfPresent(map, id, 'line-color', '#c6c6c6')
      setPaintIfPresent(map, id, 'line-opacity', 0.9)
      continue
    }

    // Basemap place labels stay, but yield to our zone labels when zoomed out.
    if (layer.type === 'symbol') {
      setPaintIfPresent(map, id, 'text-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        0.35,
        6,
        0.45,
        8,
        0.8,
      ])
      setPaintIfPresent(map, id, 'text-halo-width', 1.2)
    }
  }
}

export type Bounds = [[number, number], [number, number]]

/** Bounding box of a FeatureCollection, or undefined when it has no geometry. */
export function collectionBounds(
  collection: GeoJSON.FeatureCollection | undefined,
): Bounds | undefined {
  if (!collection?.features?.length) {
    return undefined
  }
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [lon, lat] = coords as [number, number]
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
      return
    }
    for (const child of coords) visit(child)
  }

  for (const feature of collection.features) {
    const geometry = feature.geometry as { coordinates?: unknown } | null
    if (geometry?.coordinates) visit(geometry.coordinates)
  }

  return Number.isFinite(west) ? [[west, south], [east, north]] : undefined
}
