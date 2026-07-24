import { useEffect, useMemo } from 'react'
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map,
  MapLayerMouseEvent,
} from 'maplibre-gl'
import { BAND_MAP_COLORS, CHART, IPC_COLORS } from '../../lib/format'
import type {
  AckBySituation,
  MapOverlay,
  RegionalIndicators,
  SituationFeatureCollection,
} from '../../lib/types'
import { featureCenter } from './geometry'

const ZONE_SOURCE_ID = 'dira-zones'
const POINT_SOURCE_ID = 'dira-situation-points'
const ZONE_FILL_LAYER_ID = 'dira-zones-fill'
const ZONE_LINE_LAYER_ID = 'dira-zones-line'
const ZONE_SELECTED_LAYER_ID = 'dira-zones-selected'
const HALO_LAYER_ID = 'dira-points-halo'
const CIRCLE_LAYER_ID = 'dira-points-circle'
const SELECTED_POINT_LAYER_ID = 'dira-points-selected'

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

/** Point color: operational band, with acknowledged situations flipped green. */
const BAND_POINT_COLOR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'acknowledged'], true],
  BAND_MAP_COLORS.ack,
  [
    'match',
    ['coalesce', ['get', 'operational_band'], 'none'],
    'low',
    BAND_MAP_COLORS.low,
    'watch',
    BAND_MAP_COLORS.watch,
    'elevated',
    BAND_MAP_COLORS.elevated,
    'high',
    BAND_MAP_COLORS.high,
    'very_high',
    BAND_MAP_COLORS.very_high,
    BAND_MAP_COLORS.none,
  ],
] as unknown as ExpressionSpecification

const NO_DATA_FILL = '#e0e0e0'

/** Choropleth fill per overlay — each reads a different v_zone_context property. */
export function overlayFillColor(overlay: MapOverlay): ExpressionSpecification {
  switch (overlay) {
    case 'pressure':
      return [
        'match',
        ['coalesce', ['get', 'operational_band'], 'none'],
        'low',
        BAND_MAP_COLORS.low,
        'watch',
        BAND_MAP_COLORS.watch,
        'elevated',
        BAND_MAP_COLORS.elevated,
        'high',
        BAND_MAP_COLORS.high,
        'very_high',
        BAND_MAP_COLORS.very_high,
        NO_DATA_FILL,
      ] as unknown as ExpressionSpecification
    case 'ipc':
      return [
        'match',
        ['coalesce', ['get', 'ipc_phase'], 0],
        1,
        IPC_COLORS[1],
        2,
        IPC_COLORS[2],
        3,
        IPC_COLORS[3],
        4,
        IPC_COLORS[4],
        5,
        IPC_COLORS[5],
        NO_DATA_FILL,
      ] as unknown as ExpressionSpecification
    case 'displacement':
      return [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'idps'], 0],
        0,
        CHART.blues[0],
        5_000,
        CHART.blues[2],
        20_000,
        CHART.blues[4],
        50_000,
        CHART.blues[6],
      ] as unknown as ExpressionSpecification
    case 'incidents':
      return [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'incidents_180d'], 0],
        0,
        CHART.blues[0],
        20,
        CHART.blues[2],
        60,
        CHART.blues[4],
        150,
        CHART.blues[6],
      ] as unknown as ExpressionSpecification
    case 'hazards':
      return [
        'step',
        ['coalesce', ['get', 'active_hazards'], 0],
        CHART.blues[0],
        1,
        CHART.blues[3],
        2,
        CHART.blues[5],
        3,
        CHART.blues[6],
      ] as unknown as ExpressionSpecification
  }
}

type UseMapLayersOptions = {
  map: Map | null
  indicators: RegionalIndicators | undefined
  situations: SituationFeatureCollection | undefined
  ackBySituation: AckBySituation
  overlay: MapOverlay
  selectedZoneId: string | null
  onSelect: (zoneId: string, situationId: string | null) => void
}

export function useMapLayers({
  map,
  indicators,
  situations,
  ackBySituation,
  overlay,
  selectedZoneId,
  onSelect,
}: UseMapLayersOptions): void {
  const zoneData = useMemo<GeoJSON.FeatureCollection>(
    () => indicators ?? EMPTY_COLLECTION,
    [indicators],
  )

  const points = useMemo<GeoJSON.FeatureCollection>(() => {
    const source = situations ?? (EMPTY_COLLECTION as SituationFeatureCollection)
    return {
      type: 'FeatureCollection',
      features: (source.features ?? []).flatMap((feature) => {
        const center = featureCenter(feature)
        if (!center) {
          return []
        }
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: center },
            properties: {
              ...feature.properties,
              acknowledged:
                ackBySituation[feature.properties.situation_id] ===
                'acknowledged',
            },
          },
        ]
      }),
    }
  }, [ackBySituation, situations])

  useEffect(() => {
    if (!map) {
      return
    }

    const install = () => {
      if (!map.getSource(ZONE_SOURCE_ID)) {
        map.addSource(ZONE_SOURCE_ID, { type: 'geojson', data: zoneData })
      }
      if (!map.getSource(POINT_SOURCE_ID)) {
        map.addSource(POINT_SOURCE_ID, { type: 'geojson', data: points })
      }

      if (!map.getLayer(ZONE_FILL_LAYER_ID)) {
        map.addLayer(zoneFillLayer(overlay))
      }
      if (!map.getLayer(ZONE_LINE_LAYER_ID)) {
        map.addLayer(zoneLineLayer())
      }
      if (!map.getLayer(ZONE_SELECTED_LAYER_ID)) {
        map.addLayer(zoneSelectedLayer())
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
    // Overlay is applied via setPaintProperty below; only initial install here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, zoneData, points])

  useEffect(() => {
    if (!map) {
      return
    }

    const zoneSource = map.getSource(ZONE_SOURCE_ID) as GeoJSONSource | undefined
    if (zoneSource) {
      zoneSource.setData(zoneData)
    }
    const pointSource = map.getSource(POINT_SOURCE_ID) as
      | GeoJSONSource
      | undefined
    if (pointSource) {
      pointSource.setData(points)
    }
  }, [map, zoneData, points])

  useEffect(() => {
    if (!map || !map.getLayer(ZONE_FILL_LAYER_ID)) {
      return
    }
    map.setPaintProperty(ZONE_FILL_LAYER_ID, 'fill-color', overlayFillColor(overlay))
    map.setPaintProperty(
      ZONE_FILL_LAYER_ID,
      'fill-opacity',
      overlay === 'pressure' ? 0.5 : 0.65,
    )
  }, [map, overlay])

  useEffect(() => {
    if (!map || !map.getLayer(ZONE_SELECTED_LAYER_ID)) {
      return
    }

    map.setFilter(ZONE_SELECTED_LAYER_ID, [
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
      if (hasZoneId(properties)) {
        const situationId =
          typeof properties.situation_id === 'string'
            ? properties.situation_id
            : null
        onSelect(properties.zone_id, situationId)
      }
    }
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    // Points registered before fill so situation markers win the click.
    for (const layer of [CIRCLE_LAYER_ID, HALO_LAYER_ID, ZONE_FILL_LAYER_ID]) {
      map.on('click', layer, handleClick)
      map.on('mouseenter', layer, handleMouseEnter)
      map.on('mouseleave', layer, handleMouseLeave)
    }

    return () => {
      for (const layer of [CIRCLE_LAYER_ID, HALO_LAYER_ID, ZONE_FILL_LAYER_ID]) {
        map.off('click', layer, handleClick)
        map.off('mouseenter', layer, handleMouseEnter)
        map.off('mouseleave', layer, handleMouseLeave)
      }
    }
  }, [map, onSelect])
}

function riskRadius(base: number, spread: number): ExpressionSpecification {
  return [
    '+',
    base,
    ['*', spread, ['coalesce', ['get', 'model_risk'], 0.2]],
  ] as unknown as ExpressionSpecification
}

function zoneFillLayer(overlay: MapOverlay): LayerSpecification {
  return {
    id: ZONE_FILL_LAYER_ID,
    type: 'fill',
    source: ZONE_SOURCE_ID,
    paint: {
      'fill-color': overlayFillColor(overlay),
      'fill-opacity': overlay === 'pressure' ? 0.5 : 0.65,
    },
  } as LayerSpecification
}

function zoneLineLayer(): LayerSpecification {
  return {
    id: ZONE_LINE_LAYER_ID,
    type: 'line',
    source: ZONE_SOURCE_ID,
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.9,
      'line-width': 1,
    },
  }
}

function zoneSelectedLayer(): LayerSpecification {
  return {
    id: ZONE_SELECTED_LAYER_ID,
    type: 'line',
    source: ZONE_SOURCE_ID,
    filter: ['==', ['get', 'zone_id'], ''],
    paint: {
      'line-color': '#161616',
      'line-width': 2.4,
      'line-opacity': 0.95,
    },
  }
}

function haloLayer(): LayerSpecification {
  return {
    id: HALO_LAYER_ID,
    type: 'circle',
    source: POINT_SOURCE_ID,
    paint: {
      'circle-color': BAND_POINT_COLOR,
      'circle-opacity': 0.25,
      'circle-blur': 0.6,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3.5,
        riskRadius(10, 24),
        8,
        riskRadius(22, 48),
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
      'circle-color': BAND_POINT_COLOR,
      'circle-opacity': 0.92,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.4,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3.5,
        riskRadius(3.5, 8),
        8,
        riskRadius(8, 18),
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
      'circle-stroke-color': '#161616',
      'circle-stroke-width': 2.2,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3.5,
        riskRadius(7, 11),
        8,
        riskRadius(13, 22),
      ],
    },
  } as LayerSpecification
}

function hasZoneId(value: unknown): value is {
  zone_id: string
  situation_id?: unknown
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'zone_id' in value &&
    typeof (value as { zone_id: unknown }).zone_id === 'string'
  )
}
