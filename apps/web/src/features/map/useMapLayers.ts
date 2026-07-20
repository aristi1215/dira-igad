/** Declarative MapLibre layers for the situations choropleth. */
import type { Map as MlMap, MapGeoJSONFeature } from 'maplibre-gl'
import { useEffect } from 'react'

import { zoneColor } from '../../lib/color'
import type { MapFeatureCollection } from '../../lib/types'

const SOURCE = 'situations'

/** Precompute a `color` property per feature so the fill layer is a simple data-driven paint. */
function withColors(fc: MapFeatureCollection): MapFeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        color: zoneColor(f.properties.operational_band, f.properties.acknowledged),
      },
    })),
  }
}

export function installLayers(map: MlMap): void {
  if (map.getSource(SOURCE)) return
  map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: SOURCE,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 },
  })
  map.addLayer({
    id: 'zones-outline',
    type: 'line',
    source: SOURCE,
    paint: { 'line-color': '#22303f', 'line-width': 1.2 },
  })
  map.addLayer({
    id: 'zones-selected',
    type: 'line',
    source: SOURCE,
    paint: { 'line-color': '#111827', 'line-width': 3 },
    filter: ['==', ['get', 'situation_id'], '__none__'],
  })
  map.addLayer({
    id: 'zones-label',
    type: 'symbol',
    source: SOURCE,
    layout: { 'text-field': ['get', 'zone_name'], 'text-size': 12 },
    paint: { 'text-color': '#0b1622', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
  })
}

/** Keep the source data and selection highlight in sync with server state + UI selection. */
export function useMapLayers(
  map: MlMap | null,
  ready: boolean,
  data: MapFeatureCollection | undefined,
  selectedSituationId: string | null,
): void {
  useEffect(() => {
    if (!map || !ready || !data) return
    const src = map.getSource(SOURCE)
    if (src && 'setData' in src) {
      ;(src as unknown as { setData: (d: MapFeatureCollection) => void }).setData(withColors(data))
    }
  }, [map, ready, data])

  useEffect(() => {
    if (!map || !ready) return
    map.setFilter('zones-selected', [
      '==',
      ['get', 'situation_id'],
      selectedSituationId ?? '__none__',
    ])
  }, [map, ready, selectedSituationId])
}

export type { MapGeoJSONFeature }
