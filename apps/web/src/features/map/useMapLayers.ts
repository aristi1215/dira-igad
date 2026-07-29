import { useEffect, useMemo, useRef, useState } from 'react'
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
  OperationalBand,
  RegionalIndicators,
  SituationFeatureCollection,
} from '../../lib/types'
import { featureCenter } from './geometry'
import { firstSymbolLayerId, fontStack } from './basemap'

export const ZONE_SOURCE_ID = 'dira-zones'
export const LABEL_SOURCE_ID = 'dira-zone-labels'
export const POINT_SOURCE_ID = 'dira-situation-points'
export const ZONE_FILL_LAYER_ID = 'dira-zones-fill'
export const ZONE_OUTLINE_LAYER_ID = 'dira-zones-outline'
export const ZONE_LABEL_LAYER_ID = 'dira-zones-label'
export const HALO_LAYER_ID = 'dira-points-halo'
export const CIRCLE_LAYER_ID = 'dira-points-circle'

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

const NO_DATA_FILL = '#e0e0e0'

/** Marker color: operational band, with acknowledged situations flipped green. */
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

/** Choropleth fill per overlay — each reads a different v_zone_context property. */
export function overlayFillColor(overlay: MapOverlay): ExpressionSpecification {
  switch (overlay) {
    case 'pressure':
      return [
        'match',
        ['coalesce', ['get', 'operational_band'], 'none'],
        'low', BAND_MAP_COLORS.low,
        'watch', BAND_MAP_COLORS.watch,
        'elevated', BAND_MAP_COLORS.elevated,
        'high', BAND_MAP_COLORS.high,
        'very_high', BAND_MAP_COLORS.very_high,
        NO_DATA_FILL,
      ] as unknown as ExpressionSpecification
    case 'ipc':
      return [
        'match',
        ['coalesce', ['get', 'ipc_phase'], 0],
        1, IPC_COLORS[1],
        2, IPC_COLORS[2],
        3, IPC_COLORS[3],
        4, IPC_COLORS[4],
        5, IPC_COLORS[5],
        NO_DATA_FILL,
      ] as unknown as ExpressionSpecification
    case 'displacement':
      return [
        'interpolate', ['linear'], ['coalesce', ['get', 'idps'], 0],
        0, CHART.blues[0],
        5_000, CHART.blues[2],
        20_000, CHART.blues[4],
        50_000, CHART.blues[6],
      ] as unknown as ExpressionSpecification
    case 'incidents':
      return [
        'interpolate', ['linear'], ['coalesce', ['get', 'incidents_180d'], 0],
        0, CHART.blues[0],
        20, CHART.blues[2],
        60, CHART.blues[4],
        150, CHART.blues[6],
      ] as unknown as ExpressionSpecification
    case 'hazards':
      return [
        'step', ['coalesce', ['get', 'active_hazards'], 0],
        CHART.blues[0],
        1, CHART.blues[3],
        2, CHART.blues[5],
        3, CHART.blues[6],
      ] as unknown as ExpressionSpecification
  }
}

/**
 * Base opacity per overlay. Pressure was 0.22, which left the choropleth so
 * washed out that the band colors barely read; the sequential ramps need a
 * little more presence still.
 */
function baseOpacity(overlay: MapOverlay): number {
  return overlay === 'pressure' ? 0.42 : 0.55
}

/**
 * Hover and selection are expressed as feature-state rather than extra layers
 * with filters. MapLibre interpolates `fill-opacity` natively through the
 * layer's transition, so there is no JS animation loop and no setFilter churn.
 */
function fillOpacityExpression(overlay: MapOverlay): ExpressionSpecification {
  const base = baseOpacity(overlay)
  return [
    'case',
    ['boolean', ['feature-state', 'filteredOut'], false], 0.05,
    ['boolean', ['feature-state', 'selected'], false], Math.min(0.78, base + 0.28),
    ['boolean', ['feature-state', 'hover'], false], Math.min(0.7, base + 0.16),
    base,
  ] as unknown as ExpressionSpecification
}

type UseMapLayersOptions = {
  map: Map | null
  /** Bumped when the style is swapped, to force a re-install. */
  styleEpoch: number
  indicators: RegionalIndicators | undefined
  situations: SituationFeatureCollection | undefined
  ackBySituation: AckBySituation
  overlay: MapOverlay
  selectedZoneId: string | null
  hoveredZoneId: string | null
  /** Bands currently visible. Null means no filter is applied. */
  bandFilter: Set<OperationalBand> | null
  onSelect: (zoneId: string, situationId: string | null) => void
}

export function useMapLayers({
  map,
  styleEpoch,
  indicators,
  situations,
  ackBySituation,
  overlay,
  selectedZoneId,
  hoveredZoneId,
  bandFilter,
  onSelect,
}: UseMapLayersOptions): void {
  const installedRef = useRef(false)
  /** Incremented once the layers exist, so dependent effects re-run. */
  const [installedTick, setInstalledTick] = useState(0)

  const zoneData = useMemo<GeoJSON.FeatureCollection>(
    () => indicators ?? EMPTY_COLLECTION,
    [indicators],
  )

  /** Label anchors — one point per zone at its bbox centre. */
  const labelData = useMemo<GeoJSON.FeatureCollection>(() => {
    return {
      type: 'FeatureCollection',
      features: (indicators?.features ?? []).flatMap((feature) => {
        const center = featureCenter(feature)
        if (!center) return []
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: center },
            properties: {
              zone_id: feature.properties.zone_id,
              zone_name: feature.properties.zone_name,
              model_risk: feature.properties.model_risk ?? 0,
            },
          },
        ]
      }),
    }
  }, [indicators])

  const points = useMemo<GeoJSON.FeatureCollection>(() => {
    const source = situations ?? (EMPTY_COLLECTION as SituationFeatureCollection)
    return {
      type: 'FeatureCollection',
      features: (source.features ?? []).flatMap((feature) => {
        const center = featureCenter(feature)
        if (!center) return []
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: center },
            properties: {
              ...feature.properties,
              acknowledged:
                ackBySituation[feature.properties.situation_id] === 'acknowledged',
            },
          },
        ]
      }),
    }
  }, [ackBySituation, situations])

  // Keep the latest data in a ref so the install effect can read it without
  // listing it as a dependency — otherwise every query refetch would tear
  // down and rebuild the layers. Synced in an effect (never during render,
  // which the React Compiler forbids) and declared before the install effect
  // so it is always up to date by the time install runs.
  const latest = useRef({ zoneData, labelData, points, overlay })
  useEffect(() => {
    latest.current = { zoneData, labelData, points, overlay }
  })

  // Install sources and layers. Listening on `style.load` rather than a
  // one-shot `load` means a style swap (vector → raster fallback) re-installs
  // everything instead of leaving a blank map.
  useEffect(() => {
    if (!map) return
    installedRef.current = false

    const install = () => {
      // Deliberately NOT gated on `map.isStyleLoaded()`. MapView tunes the
      // basemap in its own `style.load` handler, which runs first and leaves
      // the style dirty — so isStyleLoaded() is false right here, and gating
      // on it silently skipped the install for good.
      try {
        if (map.getSource(ZONE_SOURCE_ID)) {
          installedRef.current = true
          setInstalledTick((tick) => tick + 1)
          return
        }

        const { zoneData: zones, labelData: labels, points: pts, overlay: activeOverlay } =
          latest.current
        const beforeId = firstSymbolLayerId(map)

        // promoteId is what makes feature-state addressable by zone_id.
        map.addSource(ZONE_SOURCE_ID, {
          type: 'geojson',
          data: zones,
          promoteId: 'zone_id',
        })
        map.addSource(LABEL_SOURCE_ID, { type: 'geojson', data: labels })
        map.addSource(POINT_SOURCE_ID, { type: 'geojson', data: pts })

        // Fills and outlines go *under* the basemap's symbol layers so place
        // labels stay readable on top of the choropleth.
        map.addLayer(zoneFillLayer(activeOverlay), beforeId)
        map.addLayer(zoneOutlineLayer(), beforeId)
        map.addLayer(zoneLabelLayer(fontStack(map)))
        map.addLayer(haloLayer())
        map.addLayer(circleLayer())

        installedRef.current = true
        // Wake the effects below, which bail out while uninstalled and would
        // otherwise not re-run until one of their own dependencies changed.
        setInstalledTick((tick) => tick + 1)
      } catch (error) {
        console.warn('Could not install Dira map layers', error)
      }
    }

    if (map.isStyleLoaded()) {
      install()
    }
    map.on('style.load', install)
    return () => {
      map.off('style.load', install)
    }
  }, [map, styleEpoch])

  // Push data updates.
  useEffect(() => {
    if (!map || !installedRef.current) return
    ;(map.getSource(ZONE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(zoneData)
    ;(map.getSource(LABEL_SOURCE_ID) as GeoJSONSource | undefined)?.setData(labelData)
    ;(map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(points)
  }, [map, zoneData, labelData, points, installedTick])

  // Overlay switch: repaint in place, never re-add layers.
  useEffect(() => {
    if (!map || !map.getLayer(ZONE_FILL_LAYER_ID)) return
    map.setPaintProperty(ZONE_FILL_LAYER_ID, 'fill-color', overlayFillColor(overlay))
    map.setPaintProperty(ZONE_FILL_LAYER_ID, 'fill-opacity', fillOpacityExpression(overlay))
  }, [map, overlay, installedTick])

  // Selection, hover and band filtering as feature-state. Re-applied after
  // every data update, because replacing a GeoJSON source's data drops it.
  useEffect(() => {
    if (!map || !installedRef.current) return

    for (const feature of zoneData.features) {
      const properties = feature.properties as {
        zone_id?: string
        operational_band?: OperationalBand | null
      } | null
      const zoneId = properties?.zone_id
      if (!zoneId) continue
      const band = properties?.operational_band ?? 'low'
      map.setFeatureState(
        { source: ZONE_SOURCE_ID, id: zoneId },
        {
          selected: zoneId === selectedZoneId,
          hover: zoneId === hoveredZoneId,
          filteredOut: bandFilter ? !bandFilter.has(band as OperationalBand) : false,
        },
      )
    }
  }, [map, zoneData, selectedZoneId, hoveredZoneId, bandFilter, installedTick])

  // Hide markers for bands the legend has filtered out.
  useEffect(() => {
    if (!map || !map.getLayer(CIRCLE_LAYER_ID)) return
    map.setFilter(
      CIRCLE_LAYER_ID,
      bandFilter
        ? ([
            'in',
            ['coalesce', ['get', 'operational_band'], 'low'],
            ['literal', [...bandFilter]],
          ] as unknown as ExpressionSpecification)
        : null,
    )
    if (map.getLayer(HALO_LAYER_ID)) {
      map.setFilter(HALO_LAYER_ID, haloFilter(bandFilter))
    }
  }, [map, bandFilter, installedTick])

  // Selection ring on the marker.
  useEffect(() => {
    if (!map || !map.getLayer(CIRCLE_LAYER_ID)) return
    map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-stroke-color', [
      'case',
      ['==', ['get', 'zone_id'], selectedZoneId ?? ''],
      '#161616',
      '#ffffff',
    ])
    map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-stroke-width', [
      'case',
      ['==', ['get', 'zone_id'], selectedZoneId ?? ''],
      2.4,
      1.6,
    ])
  }, [map, selectedZoneId, installedTick])

  // Click to select. Points are registered before the fill so a marker wins
  // the click when the two overlap.
  useEffect(() => {
    if (!map) return

    const handleClick = (event: MapLayerMouseEvent) => {
      const properties = event.features?.[0]?.properties
      if (hasZoneId(properties)) {
        const situationId =
          typeof properties.situation_id === 'string' ? properties.situation_id : null
        onSelect(properties.zone_id, situationId)
      }
    }

    for (const layer of [CIRCLE_LAYER_ID, ZONE_FILL_LAYER_ID]) {
      map.on('click', layer, handleClick)
    }
    return () => {
      for (const layer of [CIRCLE_LAYER_ID, ZONE_FILL_LAYER_ID]) {
        map.off('click', layer, handleClick)
      }
    }
  }, [map, onSelect])
}

/** The halo is reserved for situations that actually need attention. */
function haloFilter(bandFilter: Set<OperationalBand> | null): ExpressionSpecification {
  const urgent: OperationalBand[] = ['high', 'very_high']
  const bands = bandFilter ? urgent.filter((band) => bandFilter.has(band)) : urgent
  return [
    'all',
    ['in', ['coalesce', ['get', 'operational_band'], 'low'], ['literal', bands]],
    ['!=', ['get', 'acknowledged'], true],
  ] as unknown as ExpressionSpecification
}

function zoneFillLayer(overlay: MapOverlay): LayerSpecification {
  return {
    id: ZONE_FILL_LAYER_ID,
    type: 'fill',
    source: ZONE_SOURCE_ID,
    paint: {
      'fill-color': overlayFillColor(overlay),
      'fill-opacity': fillOpacityExpression(overlay),
      'fill-opacity-transition': { duration: 180, delay: 0 },
    },
  } as LayerSpecification
}

/** One outline layer covers resting, hover and selection via feature-state. */
function zoneOutlineLayer(): LayerSpecification {
  return {
    id: ZONE_OUTLINE_LAYER_ID,
    type: 'line',
    source: ZONE_SOURCE_ID,
    paint: {
      'line-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], '#161616',
        ['boolean', ['feature-state', 'hover'], false], '#161616',
        '#ffffff',
      ],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 2.2,
        ['boolean', ['feature-state', 'hover'], false], 1.4,
        0.7,
      ],
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 0.95,
        ['boolean', ['feature-state', 'hover'], false], 0.6,
        0.45,
      ],
      'line-width-transition': { duration: 160, delay: 0 },
    },
  } as LayerSpecification
}

/**
 * Zone names. `symbol-sort-key` is inverted model_risk, so when two labels
 * collide the higher-risk zone's name is the one that survives.
 */
function zoneLabelLayer(font: string[]): LayerSpecification {
  return {
    id: ZONE_LABEL_LAYER_ID,
    type: 'symbol',
    source: LABEL_SOURCE_ID,
    minzoom: 4.2,
    layout: {
      'text-field': ['get', 'zone_name'],
      'text-font': font,
      'text-size': ['interpolate', ['linear'], ['zoom'], 4.5, 10, 7, 12, 10, 14],
      'text-allow-overlap': false,
      'text-padding': 4,
      'text-max-width': 9,
      // Sit the name below the marker rather than across it.
      'text-anchor': 'top',
      'text-offset': [0, 0.7],
      'symbol-sort-key': ['-', 1, ['coalesce', ['get', 'model_risk'], 0]],
    },
    paint: {
      'text-color': '#161616',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 4.2, 0, 4.8, 1],
    },
  } as LayerSpecification
}

/** Soft glow behind the markers that need attention. */
function haloLayer(): LayerSpecification {
  return {
    id: HALO_LAYER_ID,
    type: 'circle',
    source: POINT_SOURCE_ID,
    filter: haloFilter(null),
    paint: {
      'circle-color': BAND_POINT_COLOR,
      'circle-opacity': 0.22,
      'circle-blur': 0.55,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 16, 8, 30],
    },
  } as LayerSpecification
}

/**
 * Markers used to be sized by model_risk across three layers, restating what
 * the choropleth already encodes and fighting it visually. They now mean one
 * thing only — "an open situation is here" — at a near-constant size.
 */
function circleLayer(): LayerSpecification {
  return {
    id: CIRCLE_LAYER_ID,
    type: 'circle',
    source: POINT_SOURCE_ID,
    paint: {
      'circle-color': BAND_POINT_COLOR,
      'circle-opacity': 0.95,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.6,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 9],
    },
  } as LayerSpecification
}

function hasZoneId(value: unknown): value is { zone_id: string; situation_id?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'zone_id' in value &&
    typeof (value as { zone_id: unknown }).zone_id === 'string'
  )
}
