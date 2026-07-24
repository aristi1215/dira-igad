import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, { type Map } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapUiStore } from '../../stores/mapUi'
import {
  BAND_LABELS,
  BAND_MAP_COLORS,
  BAND_ORDER,
  CHART,
  IPC_COLORS,
  IPC_LABELS,
} from '../../lib/format'
import type {
  AckBySituation,
  MapOverlay,
  RegionalIndicators,
  SituationFeatureCollection,
} from '../../lib/types'
import { featureCenter } from './geometry'
import { useMapLayers } from './useMapLayers'

const OVERLAYS: { id: MapOverlay; label: string }[] = [
  { id: 'pressure', label: 'Conflict pressure' },
  { id: 'ipc', label: 'IPC phase' },
  { id: 'displacement', label: 'Displacement' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'hazards', label: 'Hazards' },
]

type MapViewProps = {
  indicators: RegionalIndicators | undefined
  situations: SituationFeatureCollection | undefined
  ackBySituation: AckBySituation
  isLoading: boolean
}

export function MapView({
  indicators,
  situations,
  ackBySituation,
  isLoading,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const lastFlownZoneIdRef = useRef<string | null>(null)
  const [map, setMap] = useState<Map | null>(null)
  const overlay = useMapUiStore((state) => state.overlay)
  const setOverlay = useMapUiStore((state) => state.setOverlay)
  const selectedZoneId = useMapUiStore((state) => state.selectedZoneId)
  const setSelectedZoneId = useMapUiStore((state) => state.setSelectedZoneId)
  const setSelectedSituationId = useMapUiStore(
    (state) => state.setSelectedSituationId,
  )

  // Create the MapLibre instance once. Viewport must NOT be an effect
  // dependency: moveend writes the store, which would tear down/rebuild
  // the map on every pan.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const initial = useMapUiStore.getState().viewport
    const nextMap = new maplibregl.Map({
      container: containerRef.current,
      style: lightStyle(),
      center: [initial.longitude, initial.latitude],
      zoom: initial.zoom,
      attributionControl: false,
    })

    nextMap.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    nextMap.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )
    nextMap.on('moveend', () => {
      const center = nextMap.getCenter()
      useMapUiStore.getState().setViewport({
        longitude: center.lng,
        latitude: center.lat,
        zoom: nextMap.getZoom(),
      })
    })

    mapRef.current = nextMap
    setMap(nextMap)

    return () => {
      nextMap.remove()
      mapRef.current = null
      setMap(null)
    }
  }, [])

  const selectFeature = useCallback(
    (zoneId: string, situationId: string | null) => {
      setSelectedZoneId(zoneId)
      setSelectedSituationId(situationId)
    },
    [setSelectedSituationId, setSelectedZoneId],
  )

  useMapLayers({
    map,
    indicators,
    situations,
    ackBySituation,
    overlay,
    selectedZoneId,
    onSelect: selectFeature,
  })

  // Fly only when the selected zone *id* changes — not when feature object
  // identity refreshes from React Query.
  useEffect(() => {
    if (!selectedZoneId) {
      lastFlownZoneIdRef.current = null
      return
    }
    if (!map || lastFlownZoneIdRef.current === selectedZoneId) {
      return
    }
    const feature = indicators?.features.find(
      (f) => f.properties.zone_id === selectedZoneId,
    )
    if (!feature) {
      return
    }
    const center = featureCenter(feature)
    if (!center) {
      return
    }

    lastFlownZoneIdRef.current = selectedZoneId
    map.flyTo({
      center,
      zoom: Math.max(map.getZoom(), 6.4),
      duration: 1_100,
    })
  }, [indicators, map, selectedZoneId])

  return (
    <div className="map-stage" aria-label="Horn of Africa map">
      <div ref={containerRef} className="map-canvas" />

      <div className="map-overlay-switch" role="tablist" aria-label="Map overlay">
        {OVERLAYS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={overlay === item.id}
            className={overlay === item.id ? 'active' : undefined}
            onClick={() => setOverlay(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="map-status">Loading operational zones…</div>
      ) : null}

      <OverlayLegend overlay={overlay} />
    </div>
  )
}

function OverlayLegend({ overlay }: { overlay: MapOverlay }) {
  if (overlay === 'pressure') {
    return (
      <div className="map-legend" aria-label="Operational band legend">
        <span className="map-legend-title">Operational band</span>
        {BAND_ORDER.filter((band) => band !== 'none').map((band) => (
          <span key={band} className="legend-swatch">
            <span style={{ background: BAND_MAP_COLORS[band] }} />
            {BAND_LABELS[band]}
          </span>
        ))}
        <span className="legend-swatch">
          <span style={{ background: BAND_MAP_COLORS.ack }} />
          Acknowledged
        </span>
      </div>
    )
  }
  if (overlay === 'ipc') {
    return (
      <div className="map-legend" aria-label="IPC phase legend">
        <span className="map-legend-title">IPC acute food insecurity</span>
        {[1, 2, 3, 4, 5].map((phase) => (
          <span key={phase} className="legend-swatch">
            <span style={{ background: IPC_COLORS[phase] }} />
            Phase {phase} · {IPC_LABELS[phase]}
          </span>
        ))}
      </div>
    )
  }

  const ramps: Record<string, { title: string; min: string; max: string }> = {
    displacement: { title: 'IDPs (latest snapshot)', min: '0', max: '50K+' },
    incidents: { title: 'Incidents, last 180 days', min: '0', max: '150+' },
    hazards: { title: 'Active hazard bulletins', min: '0', max: '3+' },
  }
  const ramp = ramps[overlay]
  return (
    <div className="map-legend" aria-label={`${ramp.title} legend`}>
      <span className="map-legend-title">{ramp.title}</span>
      <span className="legend-ramp">
        {CHART.blues.map((color) => (
          <span key={color} style={{ background: color }} />
        ))}
      </span>
      <span className="legend-ramp-labels">
        <span>{ramp.min}</span>
        <span>{ramp.max}</span>
      </span>
    </div>
  )
}

function lightStyle(): maplibregl.StyleSpecification {
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
    layers: [
      {
        id: 'carto-base',
        type: 'raster',
        source: 'carto',
      },
    ],
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  }
}
