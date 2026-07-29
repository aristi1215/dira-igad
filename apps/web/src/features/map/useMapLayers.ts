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
  MapEvents,
  MapOverlay,
  OperationalBand,
  RegionalIndicators,
} from '../../lib/types'
import { featureCenter } from './geometry'
import { firstSymbolLayerId, fontStack } from './basemap'

export const ZONE_SOURCE_ID = 'dira-zones'
export const LABEL_SOURCE_ID = 'dira-zone-labels'
export const EVENT_SOURCE_ID = 'dira-events'
export const HEAT_LAYER_ID = 'dira-heat'
export const EVENT_LAYER_ID = 'dira-events-points'
export const ZONE_FILL_LAYER_ID = 'dira-zones-fill'
export const ZONE_GLOW_LAYER_ID = 'dira-zones-glow'
export const ZONE_OUTLINE_LAYER_ID = 'dira-zones-outline'
export const ZONE_LABEL_LAYER_ID = 'dira-zones-label'

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

const NO_DATA_FILL = '#e0e0e0'

/**
 * Zoom at which individual events take over from the field.
 *
 * Below it the heat answers "where is the pressure"; above it the points
 * answer "what is it made of". Handing off rather than choosing means the map
 * never smooths away the evidence it is summarising.
 */
const EVENT_REVEAL_ZOOM = 7.5

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
    case 'markets':
      /*
       * The only variable here with a meaningful zero, so it gets the only
       * diverging ramp: staple price against its own 3-month average. Cheaper
       * left, dearer right, neutral at parity. A sequential ramp would hide
       * the thing that matters — which side of normal a zone is on.
       */
      return [
        'interpolate', ['linear'],
        ['coalesce', ['get', 'staple_pct_vs_3m_avg'], 0],
        -30, CHART.diverging[0],
        -15, CHART.diverging[1],
        -5, CHART.diverging[2],
        0, CHART.diverging[3],
        5, CHART.diverging[4],
        20, CHART.diverging[5],
        40, CHART.diverging[6],
      ] as unknown as ExpressionSpecification
  }
}

/**
 * Base opacity per overlay.
 *
 * Much lower than it used to be. Zone geometries are coarse boxes, and a
 * saturated fill makes the box itself the loudest mark on the map — which is
 * exactly the shape the data does *not* have. The fill is now a tint that
 * locates a reading; the heat field and the glow carry the intensity.
 */
function baseOpacity(overlay: MapOverlay): number {
  if (overlay === 'incidents') return 0.05 // the heat field carries this one alone
  if (overlay === 'pressure') return 0.16
  return 0.3
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
    ['boolean', ['feature-state', 'filteredOut'], false], 0.03,
    ['boolean', ['feature-state', 'selected'], false], Math.min(0.7, base + 0.3),
    ['boolean', ['feature-state', 'hover'], false], Math.min(0.6, base + 0.18),
    base,
  ] as unknown as ExpressionSpecification
}

type UseMapLayersOptions = {
  map: Map | null
  /** Bumped when the style is swapped, to force a re-install. */
  styleEpoch: number
  indicators: RegionalIndicators | undefined
  events: MapEvents | undefined
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
  events,
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

  const eventData = useMemo<GeoJSON.FeatureCollection>(
    () => events ?? EMPTY_COLLECTION,
    [events],
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

  // Keep the latest data in a ref so the install effect can read it without
  // listing it as a dependency — otherwise every query refetch would tear
  // down and rebuild the layers. Synced in an effect (never during render,
  // which the React Compiler forbids) and declared before the install effect
  // so it is always up to date by the time install runs.
  const latest = useRef({ zoneData, labelData, eventData, overlay })
  useEffect(() => {
    latest.current = { zoneData, labelData, eventData, overlay }
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

        const {
          zoneData: zones,
          labelData: labels,
          eventData: points,
          overlay: activeOverlay,
        } = latest.current
        const beforeId = firstSymbolLayerId(map)

        // promoteId is what makes feature-state addressable by zone_id.
        map.addSource(ZONE_SOURCE_ID, {
          type: 'geojson',
          data: zones,
          promoteId: 'zone_id',
        })
        map.addSource(LABEL_SOURCE_ID, { type: 'geojson', data: labels })
        map.addSource(EVENT_SOURCE_ID, { type: 'geojson', data: points })

        // Order matters: the tint locates, the glow shapes, the heat carries
        // intensity, and the individual events sit on top of all of it. All
        // of it goes *under* the basemap's symbol layers so place labels stay
        // readable.
        map.addLayer(zoneFillLayer(activeOverlay), beforeId)
        map.addLayer(zoneGlowLayer(), beforeId)
        map.addLayer(heatLayer(activeOverlay), beforeId)
        map.addLayer(zoneOutlineLayer(), beforeId)
        map.addLayer(eventLayer(activeOverlay), beforeId)
        map.addLayer(zoneLabelLayer(fontStack(map)))

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
    ;(map.getSource(EVENT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(eventData)
  }, [map, zoneData, labelData, eventData, installedTick])

  // Overlay switch: repaint in place, never re-add layers.
  useEffect(() => {
    if (!map || !map.getLayer(ZONE_FILL_LAYER_ID)) return
    map.setPaintProperty(ZONE_FILL_LAYER_ID, 'fill-color', overlayFillColor(overlay))
    map.setPaintProperty(ZONE_FILL_LAYER_ID, 'fill-opacity', fillOpacityExpression(overlay))
    if (map.getLayer(HEAT_LAYER_ID)) {
      map.setPaintProperty(HEAT_LAYER_ID, 'heatmap-opacity', heatOpacity(overlay))
    }
    if (map.getLayer(EVENT_LAYER_ID)) {
      map.setPaintProperty(EVENT_LAYER_ID, 'circle-opacity', eventOpacity(overlay))
      map.setPaintProperty(EVENT_LAYER_ID, 'circle-stroke-opacity', eventOpacity(overlay))
    }
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

  // Click to select, anywhere on a zone.
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

    map.on('click', ZONE_FILL_LAYER_ID, handleClick)
    return () => {
      map.off('click', ZONE_FILL_LAYER_ID, handleClick)
    }
  }, [map, onSelect])
}

/**
 * Kernel density over real conflict coordinates.
 *
 * This is the layer that stops the map reading as a grid. Zone geometries are
 * axis-aligned boxes, so anything painted *per zone* inherits their silhouette
 * no matter how it is styled. Events have their own coordinates and do not
 * know the boxes exist, so the field they produce has the shape of the
 * violence rather than the shape of the administrative unit.
 */
function heatLayer(overlay: MapOverlay): LayerSpecification {
  return {
    id: HEAT_LAYER_ID,
    type: 'heatmap',
    source: EVENT_SOURCE_ID,
    maxzoom: 10,
    paint: {
      // Fatalities weight the kernel, but sub-linearly: a single 40-death
      // event is worse than a 5-death one without being eight times the
      // signal, and a linear weight would let one outlier erase a district.
      'heatmap-weight': [
        'interpolate', ['linear'], ['coalesce', ['get', 'fatalities'], 0],
        0, 0.35,
        1, 0.55,
        5, 0.8,
        20, 1,
      ],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 7, 1.5, 10, 2.4],
      // Grows with zoom so the field keeps roughly the same ground footprint
      // instead of dissolving as you approach.
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 6, 34, 9, 64],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(15,98,254,0)',
        0.12, CHART.heat[0],
        0.32, CHART.heat[1],
        0.52, CHART.heat[2],
        0.7, CHART.heat[3],
        0.86, CHART.heat[4],
        1, CHART.heat[5],
      ],
      'heatmap-opacity': heatOpacity(overlay),
      'heatmap-opacity-transition': { duration: 260, delay: 0 },
    },
  } as LayerSpecification
}

/**
 * The heat is the primary reading for `incidents` and a quiet contextual
 * underlay everywhere else — it always answers "where has violence actually
 * happened", which is relevant next to any of these overlays, but it must not
 * compete with the variable the user asked for.
 */
function heatOpacity(overlay: MapOverlay): ExpressionSpecification {
  const peak = overlay === 'incidents' ? 0.85 : 0.3
  return [
    'interpolate', ['linear'], ['zoom'],
    4, peak,
    EVENT_REVEAL_ZOOM, peak * 0.85,
    9.5, peak * 0.2,
  ] as unknown as ExpressionSpecification
}

/**
 * The individual events behind the field.
 *
 * Hidden until the heat starts to fade, so zooming in trades a summary for its
 * evidence rather than losing information at the moment of closest inspection.
 */
function eventLayer(overlay: MapOverlay): LayerSpecification {
  return {
    id: EVENT_LAYER_ID,
    type: 'circle',
    source: EVENT_SOURCE_ID,
    minzoom: EVENT_REVEAL_ZOOM - 0.5,
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        7, ['interpolate', ['linear'], ['coalesce', ['get', 'fatalities'], 0], 0, 1.8, 20, 5],
        11, ['interpolate', ['linear'], ['coalesce', ['get', 'fatalities'], 0], 0, 4, 20, 13],
      ],
      // Fatal events read as the band palette's high end; non-fatal ones stay
      // neutral so the eye lands on lethality, not on event count.
      'circle-color': [
        'step', ['coalesce', ['get', 'fatalities'], 0],
        '#8d8d8d',
        1, BAND_MAP_COLORS.elevated,
        5, BAND_MAP_COLORS.high,
        15, BAND_MAP_COLORS.very_high,
      ],
      'circle-opacity': eventOpacity(overlay),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 0.8,
      'circle-stroke-opacity': eventOpacity(overlay),
      'circle-opacity-transition': { duration: 260, delay: 0 },
    },
  } as LayerSpecification
}

function eventOpacity(overlay: MapOverlay): ExpressionSpecification {
  const peak = overlay === 'incidents' ? 0.9 : 0.45
  return [
    'interpolate', ['linear'], ['zoom'],
    EVENT_REVEAL_ZOOM - 0.5, 0,
    EVENT_REVEAL_ZOOM + 0.5, peak,
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

/**
 * An inward blurred edge on the zones that need attention.
 *
 * A hard fill states "this rectangle is dangerous", which is a claim about the
 * boundary rather than about the place. A blurred inner edge states "pressure
 * is concentrated in here somewhere" — vaguer, and truer to what a zone-level
 * assessment actually knows. It is also what stops a box looking like a box.
 */
function zoneGlowLayer(): LayerSpecification {
  return {
    id: ZONE_GLOW_LAYER_ID,
    type: 'line',
    source: ZONE_SOURCE_ID,
    filter: [
      'in',
      ['coalesce', ['get', 'operational_band'], 'low'],
      ['literal', ['high', 'very_high', 'elevated']],
    ] as unknown as ExpressionSpecification,
    paint: {
      'line-color': [
        'match',
        ['coalesce', ['get', 'operational_band'], 'none'],
        'elevated', BAND_MAP_COLORS.elevated,
        'high', BAND_MAP_COLORS.high,
        'very_high', BAND_MAP_COLORS.very_high,
        BAND_MAP_COLORS.none,
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 10, 7, 22, 10, 40],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 34],
      // Negative offset pulls the stroke inside the polygon, so the glow reads
      // as the zone smouldering rather than as a halo drawn around it.
      'line-offset': ['interpolate', ['linear'], ['zoom'], 4, -5, 10, -20],
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'filteredOut'], false], 0,
        ['match',
          ['coalesce', ['get', 'operational_band'], 'none'],
          'elevated', 0.22,
          'high', 0.34,
          'very_high', 0.42,
          0,
        ],
      ],
      'line-opacity-transition': { duration: 220, delay: 0 },
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
      // Resting outlines are a warm grey hairline rather than white: they are
      // reference furniture now, not the subject, and white read as a drawn
      // border around a filled tile.
      'line-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], '#161616',
        ['boolean', ['feature-state', 'hover'], false], '#161616',
        '#8d8d8d',
      ],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 2,
        ['boolean', ['feature-state', 'hover'], false], 1.3,
        0.6,
      ],
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'filteredOut'], false], 0.12,
        ['boolean', ['feature-state', 'selected'], false], 0.95,
        ['boolean', ['feature-state', 'hover'], false], 0.6,
        0.28,
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
      'text-letter-spacing': 0.04,
      'text-transform': 'uppercase',
      // Sit the name below the anchor rather than across it.
      'text-anchor': 'top',
      'text-offset': [0, 0.7],
      'symbol-sort-key': ['-', 1, ['coalesce', ['get', 'model_risk'], 0]],
    },
    paint: {
      'text-color': '#525252',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 4.2, 0, 4.8, 1],
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
