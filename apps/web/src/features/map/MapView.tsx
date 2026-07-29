import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, { type Map } from 'maplibre-gl'
// maplibre-gl.css is imported in src/index.css inside `@layer vendor` so that
// Tailwind utilities can override it — see the note there.
import { AnimatePresence } from 'motion/react'
import { useMapUiStore } from '../../stores/mapUi'
import { Callout } from '../../components/ui'
import type {
  AckBySituation,
  MapOverlay,
  OperationalBand,
  RegionalIndicators,
  SituationFeatureCollection,
} from '../../lib/types'
import { featureCenter } from './geometry'
import { useMapLayers } from './useMapLayers'
import { useMapHover } from './useMapHover'
import { MapToolbar } from './MapToolbar'
import { MapLegend } from './MapLegend'
import { MapHoverCard } from './MapHoverCard'
import { collectionBounds, rasterFallbackStyle, tuneBasemap, VECTOR_STYLE_URL } from './basemap'
import { MAP_FLY_MS } from '../../lib/motion'
import { TOUR_ANCHORS } from '../tour/tourAnchors'

/** MapLibre needs a real WebGL context; Cursor's Simple Browser and some locked-down GPUs fail here. */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Keeps the camera over the Horn of Africa instead of lost in the Atlantic. */
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [20, -6],
  [56, 24],
]

type MapViewProps = {
  indicators: RegionalIndicators | undefined
  situations: SituationFeatureCollection | undefined
  ackBySituation: AckBySituation
  isLoading: boolean
  overlay: MapOverlay
  onOverlayChange: (overlay: MapOverlay) => void
  selectedZoneId: string | null
  onSelect: (zoneId: string, situationId: string | null) => void
}

export function MapView({
  indicators,
  situations,
  ackBySituation,
  isLoading,
  overlay,
  onOverlayChange,
  selectedZoneId,
  onSelect,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const lastFlownZoneIdRef = useRef<string | null>(null)
  const hasFramedRef = useRef(false)
  const [map, setMap] = useState<Map | null>(null)
  /** Bumped on a style swap so the layer hook re-installs everything. */
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [webglFailed, setWebglFailed] = useState(false)

  const hoveredZoneId = useMapUiStore((state) => state.hoveredZoneId)
  const setHoveredZoneId = useMapUiStore((state) => state.setHoveredZoneId)
  const bandFilter = useMapUiStore((state) => state.bandFilter)
  const toggleBand = useMapUiStore((state) => state.toggleBand)
  const resetBands = useMapUiStore((state) => state.resetBands)

  // Create the MapLibre instance once. Viewport must NOT be an effect
  // dependency: moveend writes the store, which would tear down and rebuild
  // the map on every pan.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    if (!webglAvailable()) {
      setWebglFailed(true)
      return
    }

    const initial = useMapUiStore.getState().viewport
    let nextMap: Map
    try {
      nextMap = new maplibregl.Map({
        container: containerRef.current,
        style: VECTOR_STYLE_URL,
        center: [initial.longitude, initial.latitude],
        zoom: initial.zoom,
        minZoom: 3.5,
        maxZoom: 10,
        maxBounds: MAX_BOUNDS,
        attributionControl: false,
      })
    } catch (error) {
      console.warn('MapLibre failed to initialize WebGL.', error)
      setWebglFailed(true)
      return
    }

    // Bottom-right, stacked above the attribution: the top-right corner
    // belongs to the zone card and the left edge to the watchlist.
    nextMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    nextMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    // Restyle the basemap whenever a style becomes available.
    const handleStyleLoad = () => {
      tuneBasemap(nextMap)
    }
    nextMap.on('style.load', handleStyleLoad)

    // The vector style is fetched at runtime. If it is blocked or unreachable
    // we fall back to raster tiles rather than showing a blank canvas; the
    // `style.load` listeners then re-install everything automatically.
    let usedFallback = false
    const handleError = (event: { error?: { status?: number } }) => {
      if (usedFallback || nextMap.isStyleLoaded()) {
        return
      }
      usedFallback = true
      console.warn('Vector basemap unavailable — falling back to raster tiles.', event.error)
      nextMap.setStyle(rasterFallbackStyle())
      setStyleEpoch((epoch) => epoch + 1)
    }
    nextMap.on('error', handleError)

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

    // Dev-only handle for inspecting layers and sources from the console.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __diraMap?: Map }).__diraMap = nextMap
    }

    return () => {
      nextMap.off('style.load', handleStyleLoad)
      nextMap.off('error', handleError)
      nextMap.remove()
      mapRef.current = null
      setMap(null)
    }
  }, [])

  useMapLayers({
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
  })

  const hover = useMapHover(map)

  // Frame the operating area once the zones arrive. A hardcoded centre/zoom
  // left the data as a small cluster in an ocean of empty basemap; fitting to
  // the real extent means the first thing you see is the thing you care about.
  useEffect(() => {
    if (!map || hasFramedRef.current) return
    const bounds = collectionBounds(indicators)
    if (!bounds) return
    hasFramedRef.current = true
    map.fitBounds(bounds, {
      // Leave room for the watchlist rail on the left and the legend on the right.
      padding: {
        left: window.innerWidth >= 1280 ? 348 : 288,
        right: 240,
        top: 104,
        bottom: 72,
      },
      duration: 0,
      maxZoom: 7,
    })
  }, [indicators, map])

  // Mirror map hover into the store so the watchlist rail lights up too.
  useEffect(() => {
    setHoveredZoneId(hover?.zoneId ?? null)
  }, [hover?.zoneId, setHoveredZoneId])

  // Fly only when the selected zone *id* changes — not when the feature object
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
      (candidate) => candidate.properties.zone_id === selectedZoneId,
    )
    if (!feature) {
      return
    }
    const center = featureCenter(feature)
    if (!center) {
      return
    }

    lastFlownZoneIdRef.current = selectedZoneId
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const target = { center, zoom: Math.max(map.getZoom(), 6.4) }
    if (reduceMotion) {
      map.jumpTo(target)
    } else {
      map.flyTo({ ...target, duration: MAP_FLY_MS, curve: 1.2, essential: true })
    }
  }, [indicators, map, selectedZoneId])

  const handleToggleBand = useCallback(
    (band: OperationalBand) => toggleBand(band),
    [toggleBand],
  )

  const hoveredZone = hover
    ? indicators?.features.find((feature) => feature.properties.zone_id === hover.zoneId)
        ?.properties
    : undefined

  return (
    <div className="absolute inset-0" aria-label="Horn of Africa map">
      {/* The canvas itself is not keyboard navigable; the watchlist rail is
          the accessible equivalent, so screen readers are pointed there. */}
      <div
        ref={containerRef}
        aria-hidden
        data-tour={TOUR_ANCHORS.mapCanvas}
        className="absolute inset-0 bg-surface-2"
      />

      {webglFailed ? (
        <div className="absolute inset-0 z-map-panel flex items-center justify-center bg-surface-2 p-6">
          <Callout tone="warning" title="Map needs WebGL" className="max-w-md">
            This browser cannot create a WebGL context (often Cursor&apos;s preview or hardware
            acceleration off). Open{' '}
            <a className="text-accent underline" href={window.location.href}>
              {window.location.origin}
            </a>{' '}
            in Chrome or Edge with hardware acceleration enabled, and allow localhost if an ad
            blocker is on.
          </Callout>
        </div>
      ) : null}

      {/* Gated on isLoading, never isFetching — SSE-driven refetches would
          otherwise make this strobe continuously. */}
      {isLoading && !webglFailed ? (
        <div
          role="status"
          aria-label="Loading zones"
          className="absolute inset-x-0 top-0 z-map-panel h-0.5 overflow-hidden bg-accent-soft"
        >
          <span className="block h-full w-full origin-left animate-indeterminate bg-accent" />
        </div>
      ) : null}

      {!webglFailed ? (
        <>
          <MapToolbar overlay={overlay} onChange={onOverlayChange} />

          <MapLegend
            overlay={overlay}
            bandFilter={bandFilter}
            onToggleBand={handleToggleBand}
            onResetBands={resetBands}
          />

          <AnimatePresence>
            {hover && hoveredZone ? (
              <MapHoverCard
                key={hover.zoneId}
                zone={hoveredZone}
                point={hover.point}
                overlay={overlay}
              />
            ) : null}
          </AnimatePresence>
        </>
      ) : null}
    </div>
  )
}
