import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/api'
import type { MapOverlay, ZoneSummary } from '../../lib/types'

const ZONE_PARAM = 'zone'
const OVERLAY_PARAM = 'overlay'

const OVERLAYS: MapOverlay[] = ['pressure', 'ipc', 'displacement', 'incidents', 'hazards']

function isOverlay(value: string | null): value is MapOverlay {
  return value != null && (OVERLAYS as string[]).includes(value)
}

/**
 * Map selection lives in the URL (`/?zone=…&overlay=…`) rather than in the
 * zustand store, so a view can be shared or reloaded. `situation_id` is not a
 * second parameter — it is resolved from the already-cached zones list.
 *
 * Selection uses `replace: true`: clicking through fifteen zones should not
 * leave fifteen history entries behind. Escape and the card's close button are
 * the discoverable way back to no selection.
 */
export function useSelectedZone() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const selectedZoneId = searchParams.get(ZONE_PARAM)
  const overlayParam = searchParams.get(OVERLAY_PARAM)
  const overlay: MapOverlay = isOverlay(overlayParam) ? overlayParam : 'pressure'

  const selectedSituationId =
    queryClient
      .getQueryData<ZoneSummary[]>(queryKeys.zones)
      ?.find((zone) => zone.zone_id === selectedZoneId)?.situation_id ?? null

  const selectZone = useCallback(
    (zoneId: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (zoneId) {
            next.set(ZONE_PARAM, zoneId)
          } else {
            next.delete(ZONE_PARAM)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setOverlay = useCallback(
    (next: MapOverlay) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (next === 'pressure') {
            params.delete(OVERLAY_PARAM)
          } else {
            params.set(OVERLAY_PARAM, next)
          }
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { selectedZoneId, selectedSituationId, overlay, selectZone, setOverlay }
}
