import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapView } from '../features/map'
import {
  fetchMapSituations,
  fetchRegionalIndicators,
  fetchZones,
  prepareAlert,
  queryKeys,
} from '../lib/api'
import {
  BAND_MAP_COLORS,
  fmtCompact,
  fmtRisk,
} from '../lib/format'
import { BandChip, IpcChip } from '../components/ui'
import type { AckBySituation, ZoneSummary } from '../lib/types'
import { useMapUiStore } from '../stores/mapUi'

export function MapScreen({ sseFailed }: { sseFailed: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedZoneId = useMapUiStore((state) => state.selectedZoneId)
  const setSelectedZoneId = useMapUiStore((state) => state.setSelectedZoneId)
  const setSelectedSituationId = useMapUiStore(
    (state) => state.setSelectedSituationId,
  )
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

  const prepareAlertMutation = useMutation({
    mutationFn: (situationId: string) => prepareAlert(situationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingAlerts })
      void navigate('/dispatch')
    },
  })

  const selectZone = (zone: ZoneSummary) => {
    setSelectedZoneId(zone.zone_id)
    setSelectedSituationId(zone.situation_id)
  }

  return (
    <div className="map-screen">
      <MapView
        indicators={indicatorsQuery.data}
        situations={situationsQuery.data}
        ackBySituation={ackQuery.data}
        isLoading={indicatorsQuery.isLoading || situationsQuery.isLoading}
      />

      {indicatorsQuery.isError ? (
        <p className="error-note map-status">
          Regional indicators are unavailable: {indicatorsQuery.error.message}
        </p>
      ) : null}

      <aside className="map-rail" aria-label="Zone watchlist">
        <div className="map-rail-head">
          <h2>Watchlist</h2>
          <p>All 22 zones, ranked by model risk (latest cycle)</p>
        </div>
        <div className="map-rail-list">
          {watchlist.map((zone) => (
            <button
              key={zone.zone_id}
              type="button"
              className={
                zone.zone_id === selectedZoneId ? 'zone-row active' : 'zone-row'
              }
              onClick={() => selectZone(zone)}
            >
              <span
                className="band-dot"
                style={{
                  background:
                    BAND_MAP_COLORS[zone.operational_band ?? 'none'],
                }}
              />
              <span className="zone-row-main">
                <strong>{zone.zone_name}</strong>
                <small>
                  {zone.country_iso2} · {zone.cluster_name}
                </small>
              </span>
              <span className="risk-index">{fmtRisk(zone.model_risk)}</span>
            </button>
          ))}
          {zonesQuery.isLoading ? (
            <p className="loading-note">Loading zones…</p>
          ) : null}
        </div>
      </aside>

      {selectedZone ? (
        <section className="map-zone-card" aria-label="Selected zone">
          <div className="map-zone-card-head">
            <div>
              <h2>{selectedZone.zone_name}</h2>
              <small>
                {selectedZone.country_iso2} · {selectedZone.cluster_name}
              </small>
            </div>
            <button
              type="button"
              className="close-button"
              aria-label="Clear selection"
              onClick={() => {
                setSelectedZoneId(null)
                setSelectedSituationId(null)
              }}
            >
              ×
            </button>
          </div>

          <div className="feed-item-head">
            <BandChip band={selectedZone.operational_band} />
            <IpcChip phase={selectedZone.ipc_phase} />
          </div>

          <dl className="map-zone-facts">
            <div>
              <dt>Model risk</dt>
              <dd>{fmtRisk(selectedZone.model_risk)}</dd>
            </div>
            <div>
              <dt>IDPs</dt>
              <dd>{fmtCompact(selectedZone.idps)}</dd>
            </div>
            <div>
              <dt>Population</dt>
              <dd>{fmtCompact(selectedZone.population)}</dd>
            </div>
            <div>
              <dt>Verified reports</dt>
              <dd>{selectedZone.verified_field_reports_recent ?? 0}</dd>
            </div>
            <div>
              <dt>Hazards</dt>
              <dd>{selectedZone.active_hazards ?? 0}</dd>
            </div>
            <div>
              <dt>Health alerts</dt>
              <dd>{selectedZone.active_health_alerts ?? 0}</dd>
            </div>
          </dl>

          <div className="card-actions">
            <button
              type="button"
              className="button button-primary button-small"
              onClick={() => void navigate(`/zones/${selectedZone.zone_id}`)}
            >
              Open dossier →
            </button>
            {selectedZone.situation_id ? (
              <>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() =>
                    void navigate(`/situations/${selectedZone.situation_id}`)
                  }
                >
                  View situation
                </button>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  disabled={prepareAlertMutation.isPending}
                  onClick={() =>
                    prepareAlertMutation.mutate(selectedZone.situation_id!)
                  }
                >
                  {prepareAlertMutation.isPending ? 'Drafting…' : 'Prepare alert'}
                </button>
              </>
            ) : null}
          </div>
          {prepareAlertMutation.isError ? (
            <p className="error-note">
              Could not draft the alert:{' '}
              {prepareAlertMutation.error instanceof Error
                ? prepareAlertMutation.error.message
                : 'request failed'}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
