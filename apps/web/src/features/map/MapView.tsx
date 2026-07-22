import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapUiStore } from '../../stores/mapUi'
import type {
  AckBySituation,
  SituationFeature,
  SituationFeatureCollection,
} from '../../lib/types'
import { useMapLayers } from './useMapLayers'

const MANDERA_CENTER: [number, number] = [41.8, 3.9]
const IGAD_CENTER: [number, number] = [38.5, 6.2]

type MapViewProps = {
  situations: SituationFeatureCollection | undefined
  ackBySituation: AckBySituation
  isLoading: boolean
}

export function MapView({
  situations,
  ackBySituation,
  isLoading,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const [map, setMap] = useState<Map | null>(null)
  const activeLayers = useMapUiStore((state) => state.activeLayers)
  const selectedZoneId = useMapUiStore((state) => state.selectedZoneId)
  const selectedSituationId = useMapUiStore((state) => state.selectedSituationId)
  const viewport = useMapUiStore((state) => state.viewport)
  const setActiveLayers = useMapUiStore((state) => state.setActiveLayers)
  const setSelectedZoneId = useMapUiStore((state) => state.setSelectedZoneId)
  const setSelectedSituationId = useMapUiStore(
    (state) => state.setSelectedSituationId,
  )
  const setViewport = useMapUiStore((state) => state.setViewport)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const nextMap = new maplibregl.Map({
      container: containerRef.current,
      style: hornStyle(),
      center: [viewport.longitude, viewport.latitude],
      zoom: viewport.zoom,
      attributionControl: false,
    })

    nextMap.addControl(new maplibregl.NavigationControl(), 'top-right')
    nextMap.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )
    nextMap.on('moveend', () => {
      const center = nextMap.getCenter()
      setViewport({
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
  }, [setViewport, viewport.latitude, viewport.longitude, viewport.zoom])

  const selectFeature = useCallback(
    (zoneId: string, situationId: string) => {
      setSelectedZoneId(zoneId)
      setSelectedSituationId(situationId)
    },
    [setSelectedSituationId, setSelectedZoneId],
  )

  const layeredSituations = useMapLayers({
    map,
    situations,
    ackBySituation,
    activeLayers,
    selectedZoneId,
    onSelect: selectFeature,
  })

  const selectedFeature = useMemo(
    () =>
      layeredSituations.features.find(
        (feature) => feature.properties.situation_id === selectedSituationId,
      ) ?? null,
    [layeredSituations.features, selectedSituationId],
  )

  useEffect(() => {
    if (!map || !selectedFeature) {
      return
    }

    const center = featureCenter(selectedFeature)
    if (center) {
      map.flyTo({
        center,
        zoom: Math.max(map.getZoom(), 8.2),
        duration: 1_100,
      })
    }
  }, [map, selectedFeature])

  const zonesEnabled = activeLayers.includes('situations')

  return (
    <section className="map-panel panel-fade" aria-label="Horn of Africa map">
      <div className="map-toolbar">
        <div>
          <p className="eyebrow">Amani live map</p>
          <h2>IGAD regional view</h2>
        </div>
        <div className="map-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              map?.flyTo({
                center: IGAD_CENTER,
                zoom: 4.4,
                duration: 1_200,
              })
            }}
          >
            IGAD region
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              map?.flyTo({
                center: MANDERA_CENTER,
                zoom: 7.4,
                duration: 1_200,
              })
            }}
          >
            Mandera cluster
          </button>
          <button
            className="button button-secondary"
            type="button"
            aria-pressed={zonesEnabled}
            onClick={() =>
              setActiveLayers(zonesEnabled ? [] : ['situations'])
            }
          >
            Zones {zonesEnabled ? 'on' : 'off'}
          </button>
        </div>
      </div>
      <div className="map-canvas-wrap">
        <div ref={containerRef} className="map-canvas" />
        {isLoading ? (
          <div className="map-status">Loading operational zones...</div>
        ) : null}
      </div>
      <BandLegend />
    </section>
  )
}

function BandLegend() {
  return (
    <div className="band-legend" aria-label="Operational band legend">
      <LegendSwatch label="Low" color="#94a3b8" />
      <LegendSwatch label="Watch" color="#fbbf24" />
      <LegendSwatch label="Elevated" color="#fb923c" />
      <LegendSwatch label="High" color="#ef4444" />
      <LegendSwatch label="Very high" color="#9f1239" />
      <LegendSwatch label="Ack" color="#22c55e" />
    </div>
  )
}

function LegendSwatch({ label, color }: { label: string; color: string }) {
  return (
    <span className="legend-swatch">
      <span style={{ background: color }} />
      {label}
    </span>
  )
}

function hornStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: 'OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'osm-base',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-opacity': 0.34,
          'raster-saturation': -0.65,
          'raster-contrast': 0.08,
        },
      },
    ],
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  }
}

function featureCenter(feature: SituationFeature): [number, number] | null {
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

function flattenGeometry(
  geometry: SituationFeature['geometry'],
): [number, number][] {
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
