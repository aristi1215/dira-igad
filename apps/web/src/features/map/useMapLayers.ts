import { useEffect, useMemo } from 'react'
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map,
  MapLayerMouseEvent,
} from 'maplibre-gl'
import type {
  AckBySituation,
  SituationFeatureCollection,
} from '../../lib/types'
import { featureCenter } from './geometry'

const SOURCE_ID = 'dira-situations'
const POINT_SOURCE_ID = 'dira-situation-points'
const FILL_LAYER_ID = 'dira-situations-fill'
const LINE_LAYER_ID = 'dira-situations-line'
const SELECTED_LAYER_ID = 'dira-situations-selected'
const HALO_LAYER_ID = 'dira-points-halo'
const CIRCLE_LAYER_ID = 'dira-points-circle'
const SELECTED_POINT_LAYER_ID = 'dira-points-selected'

const EMPTY_COLLECTION: SituationFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

const BAND_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'acknowledged'], true],
  '#22c55e',
  [
    'match',
    ['get', 'operational_band'],
    'low',
    '#64d3ff',
    'watch',
    '#fbbf24',
    'elevated',
    '#fb923c',
    'high',
    '#ef4444',
    'very_high',
    '#be123c',
    '#94a3b8',
  ],
] as unknown as ExpressionSpecification

type UseMapLayersOptions = {
  map: Map | null
  situations: SituationFeatureCollection | undefined
  ackBySituation: AckBySituation
  activeLayers: string[]
  selectedZoneId: string | null
  onSelect: (zoneId: string, situationId: string) => void
}

export function useMapLayers({
  map,
  situations,
  ackBySituation,
  activeLayers,
  selectedZoneId,
  onSelect,
}: UseMapLayersOptions): SituationFeatureCollection {
  const data = useMemo<SituationFeatureCollection>(() => {
    const source = situations ?? EMPTY_COLLECTION

    return {
      ...source,
      features: source.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          acknowledged:
            ackBySituation[feature.properties.situation_id] === 'acknowledged',
        },
      })),
    }
  }, [ackBySituation, situations])

  const points = useMemo<GeoJSON.FeatureCollection>(() => {
    return {
      type: 'FeatureCollection',
      features: data.features.flatMap((feature) => {
        const center = featureCenter(feature)
        if (!center) {
          return []
        }
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: center },
            properties: feature.properties,
          },
        ]
      }),
    }
  }, [data])

  useEffect(() => {
    if (!map) {
      return
    }

    const install = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data,
        })
      }
      if (!map.getSource(POINT_SOURCE_ID)) {
        map.addSource(POINT_SOURCE_ID, {
          type: 'geojson',
          data: points,
        })
      }

      if (!map.getLayer(FILL_LAYER_ID)) {
        map.addLayer(zoneFillLayer())
      }

      if (!map.getLayer(LINE_LAYER_ID)) {
        map.addLayer(zoneLineLayer())
      }

      if (!map.getLayer(SELECTED_LAYER_ID)) {
        map.addLayer(selectedZoneLayer())
      }

      if (!map.getLayer(HALO_LAYER_ID)) {
        map.addLayer(haloLayer())
      }

      if (!map.getLayer(CIRCLE_LAYER_ID)) {
        map.addLayer(circleLayer())
      }

      if (!map.getLayer(SELECTED_POINT_LAYER_ID)) {
        map.addLayer(selectedPointLayer())
      }
    }

    if (map.loaded()) {
      install()
      return
    }

    map.once('load', install)
    return () => {
      map.off('load', install)
    }
  }, [data, map, points])

  useEffect(() => {
    if (!map) {
      return
    }

    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    if (source) {
      source.setData(data)
    }
    const pointSource = map.getSource(POINT_SOURCE_ID) as
      | GeoJSONSource
      | undefined
    if (pointSource) {
      pointSource.setData(points)
    }
  }, [data, map, points])

  useEffect(() => {
    if (!map || !map.getLayer(FILL_LAYER_ID)) {
      return
    }

    const visibility = activeLayers.includes('situations') ? 'visible' : 'none'
    map.setLayoutProperty(FILL_LAYER_ID, 'visibility', visibility)
    map.setLayoutProperty(LINE_LAYER_ID, 'visibility', visibility)
    map.setLayoutProperty(SELECTED_LAYER_ID, 'visibility', visibility)
  }, [activeLayers, map])

  useEffect(() => {
    if (!map || !map.getLayer(SELECTED_LAYER_ID)) {
      return
    }

    map.setFilter(SELECTED_LAYER_ID, [
      '==',
      ['get', 'zone_id'],
      selectedZoneId ?? '',
    ])
    if (map.getLayer(SELECTED_POINT_LAYER_ID)) {
      map.setFilter(SELECTED_POINT_LAYER_ID, [
        '==',
        ['get', 'zone_id'],
        selectedZoneId ?? '',
      ])
    }
  }, [map, selectedZoneId])

  useEffect(() => {
    if (!map) {
      return
    }

    const handleClick = (event: MapLayerMouseEvent) => {
      const properties = event.features?.[0]?.properties
      if (hasSelectableProperties(properties)) {
        onSelect(properties.zone_id, properties.situation_id)
      }
    }
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    for (const layer of [FILL_LAYER_ID, CIRCLE_LAYER_ID, HALO_LAYER_ID]) {
      map.on('click', layer, handleClick)
      map.on('mouseenter', layer, handleMouseEnter)
      map.on('mouseleave', layer, handleMouseLeave)
    }

    return () => {
      for (const layer of [FILL_LAYER_ID, CIRCLE_LAYER_ID, HALO_LAYER_ID]) {
        map.off('click', layer, handleClick)
        map.off('mouseenter', layer, handleMouseEnter)
        map.off('mouseleave', layer, handleMouseLeave)
      }
    }
  }, [map, onSelect])

  return data
}

function riskRadius(base: number, spread: number): ExpressionSpecification {
  return [
    '+',
    base,
    ['*', spread, ['coalesce', ['get', 'model_risk'], 0.2]],
  ] as unknown as ExpressionSpecification
}

function haloLayer(): LayerSpecification {
  return {
    id: HALO_LAYER_ID,
    type: 'circle',
    source: POINT_SOURCE_ID,
    paint: {
      'circle-color': BAND_COLOR,
      'circle-opacity': 0.22,
      'circle-blur': 0.6,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3.5,
        riskRadius(10, 26),
        8,
        riskRadius(22, 52),
      ],
    },
  } as LayerSpecification
}

function circleLayer(): LayerSpecification {
  return {
    id: CIRCLE_LAYER_ID,
    type: 'circle',
    source: POINT_SOURCE_ID,
    paint: {
      'circle-color': BAND_COLOR,
      'circle-opacity': 0.88,
      'circle-stroke-color': 'rgba(255, 255, 255, 0.75)',
      'circle-stroke-width': 1.2,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3.5,
        riskRadius(3.5, 9),
        8,
        riskRadius(8, 20),
      ],
    },
  } as LayerSpecification
}

function selectedPointLayer(): LayerSpecification {
  return {
    id: SELECTED_POINT_LAYER_ID,
    type: 'circle',
    source: POINT_SOURCE_ID,
    filter: ['==', ['get', 'zone_id'], ''],
    paint: {
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-color': '#ecfeff',
      'circle-stroke-width': 2.4,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3.5,
        riskRadius(7, 12),
        8,
        riskRadius(13, 24),
      ],
    },
  } as LayerSpecification
}

function zoneFillLayer(): LayerSpecification {
  return {
    id: FILL_LAYER_ID,
    type: 'fill',
    source: SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': BAND_COLOR,
      'fill-opacity': 0.32,
    },
  } as LayerSpecification
}

function zoneLineLayer(): LayerSpecification {
  return {
    id: LINE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#d9f99d',
      'line-opacity': 0.35,
      'line-width': 1.2,
    },
  }
}

function selectedZoneLayer(): LayerSpecification {
  return {
    id: SELECTED_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { visibility: 'none' },
    filter: ['==', ['get', 'zone_id'], ''],
    paint: {
      'line-color': '#ecfeff',
      'line-width': 3,
      'line-opacity': 0.9,
    },
  }
}

function hasSelectableProperties(
  value: unknown,
): value is { zone_id: string; situation_id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'zone_id' in value &&
    'situation_id' in value &&
    typeof value.zone_id === 'string' &&
    typeof value.situation_id === 'string'
  )
}
