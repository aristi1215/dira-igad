import { useEffect, useState } from 'react'
import type { Map, MapLayerMouseEvent } from 'maplibre-gl'
import { CIRCLE_LAYER_ID, ZONE_FILL_LAYER_ID } from './useMapLayers'

export type HoverState = {
  zoneId: string
  point: { x: number; y: number }
} | null

/**
 * Tracks the hovered zone and the cursor position that produced it.
 *
 * The zone id is compared against the previous one before updating so that
 * moving the cursor within a single polygon does not re-render on every
 * mousemove; the cursor point still tracks continuously so the hover card
 * follows smoothly.
 */
export function useMapHover(map: Map | null): HoverState {
  const [hover, setHover] = useState<HoverState>(null)

  useEffect(() => {
    if (!map) return

    const handleMove = (event: MapLayerMouseEvent) => {
      const properties = event.features?.[0]?.properties as { zone_id?: unknown } | undefined
      const zoneId = typeof properties?.zone_id === 'string' ? properties.zone_id : null
      if (!zoneId) return

      const point = { x: event.originalEvent.clientX, y: event.originalEvent.clientY }
      setHover((current) =>
        current?.zoneId === zoneId && current.point.x === point.x && current.point.y === point.y
          ? current
          : { zoneId, point },
      )
      map.getCanvas().style.cursor = 'pointer'
    }

    const handleLeave = () => {
      setHover(null)
      map.getCanvas().style.cursor = ''
    }

    const layers = [CIRCLE_LAYER_ID, ZONE_FILL_LAYER_ID]
    for (const layer of layers) {
      map.on('mousemove', layer, handleMove)
      map.on('mouseleave', layer, handleLeave)
    }
    return () => {
      for (const layer of layers) {
        map.off('mousemove', layer, handleMove)
        map.off('mouseleave', layer, handleLeave)
      }
    }
  }, [map])

  return hover
}
