import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapView, WatchlistRail, ZoneCard } from '../features/map'
import {
  fetchMapSituations,
  fetchRegionalIndicators,
  fetchZones,
  prepareAlert,
  queryKeys,
} from '../lib/api'
import { useSelectedZone } from '../features/map/useSelectedZone'
import { useMapUiStore } from '../stores/mapUi'
import { Button, Callout } from '../components/ui'
import type { AckBySituation, ZoneSummary } from '../lib/types'

export function MapScreen() {
  const { sseFailed } = useOutletContext<{ sseFailed: boolean }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { selectedZoneId, overlay, selectZone, setOverlay } = useSelectedZone()
  const hoveredZoneId = useMapUiStore((state) => state.hoveredZoneId)
  const setHoveredZoneId = useMapUiStore((state) => state.setHoveredZoneId)
  const bandFilter = useMapUiStore((state) => state.bandFilter)

  const fallbackInterval = sseFailed ? 5_000 : false

  const indicatorsQuery = useQuery({
    queryKey: queryKeys.regionalIndicators,
    queryFn: fetchRegionalIndicators,
    refetchInterval: fallbackInterval,
  })
  const situationsQuery = useQuery({
    queryKey: queryKeys.mapSituations,
    queryFn: fetchMapSituations,
    refetchInterval: fallbackInterval,
  })
  const zonesQuery = useQuery({
    queryKey: queryKeys.zones,
    queryFn: fetchZones,
    refetchInterval: fallbackInterval,
  })
  // Ack cache is written exclusively by the SSE patcher (DTMF "1" callbacks).
  const ackQuery = useQuery<AckBySituation>({
    queryKey: queryKeys.ackBySituation,
    queryFn: () => Promise.resolve({}),
    enabled: false,
    initialData: {},
    staleTime: Number.POSITIVE_INFINITY,
  })

  const watchlist = useMemo(() => {
    const zones = zonesQuery.data ?? []
    return [...zones].sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1))
  }, [zonesQuery.data])

  const selectedZone = useMemo(
    () => watchlist.find((zone) => zone.zone_id === selectedZoneId) ?? null,
    [selectedZoneId, watchlist],
  )

  const selectedSituation = useMemo(() => {
    if (!selectedZoneId) return null
    return (
      situationsQuery.data?.features.find(
        (feature) => feature.properties.zone_id === selectedZoneId,
      )?.properties ?? null
    )
  }, [selectedZoneId, situationsQuery.data])

  const prepareAlertMutation = useMutation({
    mutationFn: (situationId: string) => prepareAlert(situationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingAlerts })
      void navigate('/dispatch')
    },
  })

  const handleMapSelect = useCallback(
    (zoneId: string) => selectZone(zoneId),
    [selectZone],
  )

  const handleRailSelect = useCallback(
    (zone: ZoneSummary) => selectZone(zone.zone_id),
    [selectZone],
  )

  // Escape clears the selection — the discoverable counterpart to the card's
  // close button, since selection uses history.replace and Back would leave.
  useEffect(() => {
    if (!selectedZoneId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selectZone(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectZone, selectedZoneId])

  return (
    <div className="absolute inset-0">
      <MapView
        indicators={indicatorsQuery.data}
        situations={situationsQuery.data}
        ackBySituation={ackQuery.data}
        isLoading={indicatorsQuery.isLoading || situationsQuery.isLoading}
        overlay={overlay}
        onOverlayChange={setOverlay}
        selectedZoneId={selectedZoneId}
        onSelect={handleMapSelect}
      />

      <WatchlistRail
        zones={watchlist}
        isLoading={zonesQuery.isLoading}
        selectedZoneId={selectedZoneId}
        hoveredZoneId={hoveredZoneId}
        bandFilter={bandFilter}
        onSelect={handleRailSelect}
        onHover={setHoveredZoneId}
      />

      {selectedZone ? (
        <ZoneCard
          key={selectedZone.zone_id}
          zone={selectedZone}
          situation={selectedSituation}
          onClose={() => selectZone(null)}
          onPrepareAlert={(situationId) => prepareAlertMutation.mutate(situationId)}
          preparingAlert={prepareAlertMutation.isPending}
        />
      ) : null}

      {indicatorsQuery.isError ? (
        <Callout
          tone="danger"
          title="Regional indicators are unavailable"
          className="pointer-events-auto absolute bottom-9 left-1/2 z-map-panel w-[26rem] max-w-[90vw] -translate-x-1/2 shadow-panel"
          actions={
            <Button size="sm" onClick={() => void indicatorsQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {indicatorsQuery.error.message}
        </Callout>
      ) : null}

      {prepareAlertMutation.isError ? (
        <Callout
          tone="danger"
          title="Could not draft the alert"
          className="pointer-events-auto absolute bottom-9 left-1/2 z-map-panel w-[26rem] max-w-[90vw] -translate-x-1/2 shadow-panel"
        >
          {prepareAlertMutation.error instanceof Error
            ? prepareAlertMutation.error.message
            : 'Request failed.'}
        </Callout>
      ) : null}
    </div>
  )
}
