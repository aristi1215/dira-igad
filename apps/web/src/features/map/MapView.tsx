import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapUiStore } from '../../stores/mapUi'
import type {
  AckBySituation,
  SituationFeatureCollection,
} from '../../lib/types'
import { featureCenter } from './geometry'
import { useMapLayers } from './useMapLayers'

const MANDERA_CENTER: [number, number] = [41.8, 3.9]
const IGAD_CENTER: [number, number] = [38.5, 6.2]

type MapViewProps = {
  situations: SituationFeatureCollection | undefined
  ackBySituation: AckBySituation
  isLoading: boolean
  cycle: string | null
  sseFailed: boolean
}

export function MapView({
  situations,
  ackBySituation,
  isLoading,
  cycle,
  sseFailed,
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
      style: darkStyle(),
      center: [viewport.longitude, viewport.latitude],
      zoom: viewport.zoom,
      attributionControl: false,
    })

    nextMap.addControl(new maplibregl.NavigationControl(), 'bottom-right')
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
        zoom: Math.max(map.getZoom(), 6.6),
        duration: 1_100,
      })
    }
  }, [map, selectedFeature])

  const zonesEnabled = activeLayers.includes('situations')

  return (
    <div className="map-stage" aria-label="Horn of Africa map">
      <div ref={containerRef} className="map-canvas" />

      <div className="map-topbar">
        <span className="brand-chip">DIRA · IGAD early warning</span>
        <div className="map-topbar-right">
          {cycle ? <span className="cycle-chip">Cycle {cycle}</span> : null}
          <span className="header-status">
            <span className={sseFailed ? 'status-dot fallback' : 'status-dot'} />
            {sseFailed ? 'Polling' : 'Live'}
          </span>
        </div>
      </div>

      <div className="map-controls">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            map?.flyTo({ center: IGAD_CENTER, zoom: 4.4, duration: 1_200 })
          }}
        >
          IGAD region
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            map?.flyTo({ center: MANDERA_CENTER, zoom: 7.4, duration: 1_200 })
          }}
        >
          Mandera cluster
        </button>
        <button
          className="button button-secondary"
          type="button"
          aria-pressed={zonesEnabled}
          onClick={() => setActiveLayers(zonesEnabled ? [] : ['situations'])}
        >
          Zone outlines {zonesEnabled ? 'on' : 'off'}
        </button>
      </div>

      {isLoading ? (
        <div className="map-status">Loading operational zones...</div>
      ) : null}

      <BandLegend />
    </div>
  )
}

function BandLegend() {
  return (
    <div className="band-legend" aria-label="Operational band legend">
      <LegendSwatch label="Low" color="#64d3ff" />
      <LegendSwatch label="Watch" color="#fbbf24" />
      <LegendSwatch label="Elevated" color="#fb923c" />
      <LegendSwatch label="High" color="#ef4444" />
      <LegendSwatch label="Very high" color="#be123c" />
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

function darkStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
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
        paint: {
          'raster-opacity': 0.94,
        },
      },
    ],
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  }
}
