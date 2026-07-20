/** MapLibre map: regional view + Mandera zoom, zones coloured by operational band. */
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'

import type { MapFeatureCollection } from '../../lib/types'
import { installLayers, useMapLayers } from './useMapLayers'

// Offline-friendly minimal style (no external tiles): flat background + our GeoJSON zones.
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9eef3' } }],
}

const MANDERA_CENTER: [number, number] = [41.9, 3.95]

interface Props {
  data: MapFeatureCollection | undefined
  selectedSituationId: string | null
  onSelect: (situationId: string) => void
}

export function MapView({ data, selectedSituationId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: MANDERA_CENTER,
      zoom: 7.4,
    })
    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    m.on('load', () => {
      installLayers(m)
      m.on('click', 'zones-fill', (e) => {
        const sid = e.features?.[0]?.properties?.situation_id
        if (typeof sid === 'string') onSelect(sid)
      })
      m.on('mouseenter', 'zones-fill', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'zones-fill', () => (m.getCanvas().style.cursor = ''))
      setReady(true)
    })
    setMap(m)
    return () => {
      m.remove()
      setMap(null)
      setReady(false)
    }
  }, [onSelect])

  useMapLayers(map, ready, data, selectedSituationId)

  return <div ref={container} className="map-canvas" />
}
