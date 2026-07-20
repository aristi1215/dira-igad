import { useEffect, useMemo } from 'react'
import type {
  GeoJSONSource,
  LayerSpecification,
  Map,
  MapLayerMouseEvent,
} from 'maplibre-gl'
import type {
  AckBySituation,
  SituationFeatureCollection,
} from '../../lib/types'

const SOURCE_ID = 'dira-situations'
const FILL_LAYER_ID = 'dira-situations-fill'
const LINE_LAYER_ID = 'dira-situations-line'
const SELECTED_LAYER_ID = 'dira-situations-selected'

const EMPTY_COLLECTION: SituationFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

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

      if (!map.getLayer(FILL_LAYER_ID)) {
        map.addLayer(zoneFillLayer())
      }

      if (!map.getLayer(LINE_LAYER_ID)) {
        map.addLayer(zoneLineLayer())
      }

      if (!map.getLayer(SELECTED_LAYER_ID)) {
        map.addLayer(selectedZoneLayer())
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
  }, [data, map])

  useEffect(() => {
    if (!map || !map.getSource(SOURCE_ID)) {
      return
    }

    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    if (source) {
      source.setData(data)
    }
  }, [data, map])

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

    map.on('click', FILL_LAYER_ID, handleClick)
    map.on('mouseenter', FILL_LAYER_ID, handleMouseEnter)
    map.on('mouseleave', FILL_LAYER_ID, handleMouseLeave)

    return () => {
      map.off('click', FILL_LAYER_ID, handleClick)
      map.off('mouseenter', FILL_LAYER_ID, handleMouseEnter)
      map.off('mouseleave', FILL_LAYER_ID, handleMouseLeave)
    }
  }, [map, onSelect])

  return data
}

function zoneFillLayer(): LayerSpecification {
  return {
    id: FILL_LAYER_ID,
    type: 'fill',
    source: SOURCE_ID,
    paint: {
      'fill-color': [
        'case',
        ['==', ['get', 'acknowledged'], true],
        '#22c55e',
        [
          'match',
          ['get', 'operational_band'],
          'low',
          '#94a3b8',
          'watch',
          '#fbbf24',
          'elevated',
          '#fb923c',
          'high',
          '#ef4444',
          'very_high',
          '#9f1239',
          '#cbd5e1',
        ],
      ],
      'fill-opacity': 0.72,
    },
  }
}

function zoneLineLayer(): LayerSpecification {
  return {
    id: LINE_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    paint: {
      'line-color': '#d9f99d',
      'line-opacity': 0.42,
      'line-width': 1.4,
    },
  }
}

function selectedZoneLayer(): LayerSpecification {
  return {
    id: SELECTED_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'zone_id'], ''],
    paint: {
      'line-color': '#ecfeff',
      'line-width': 4,
      'line-opacity': 0.92,
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
