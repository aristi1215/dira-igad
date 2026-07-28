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
  BAND_COLORS,
  BAND_GUIDANCE,
  BAND_LABELS,
  BAND_MAP_COLORS,
  COUNTRY_NAMES,
  fmtCompact,
  fmtForecastWindow,
  fmtRisk,
  fmtRiskScore,
} from '../lib/format'
import { BandChip, IpcChip, ScoreMeter } from '../components/ui'
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

  const selectedSituationProps = useMemo(() => {
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

  const selectZone = (zone: ZoneSummary) => {
    setSelectedZoneId(zone.zone_id)
    setSelectedSituationId(zone.situation_id)
  }

  const selectedBand = selectedZone?.operational_band ?? 'none'

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
          <p>Ranked by conflict pressure</p>
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
              <span className="risk-index">{fmtRiskScore(zone.model_risk)}</span>
            </button>
          ))}
          {zonesQuery.isLoading ? (
            <p className="loading-note">Loading zones…</p>
          ) : null}
        </div>
      </aside>

      {selectedZone ? (
        <section className="map-zone-card" aria-label="Selected zone">
          <header className="mzc-head">
            <div>
              <h2>{selectedZone.zone_name}</h2>
              <p className="mzc-sub">
                {COUNTRY_NAMES[selectedZone.country_iso2] ?? selectedZone.country_iso2}{' '}
                · {selectedZone.cluster_name}
              </p>
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
          </header>

          <div className="mzc-hero" data-band={selectedBand}>
            <div className="mzc-hero-top">
              <span className="mzc-band-label">
                {BAND_LABELS[selectedBand]} risk
              </span>
              <IpcChip phase={selectedZone.ipc_phase} />
            </div>
            <p className="mzc-guidance">{BAND_GUIDANCE[selectedBand]}</p>
            <div className="mzc-meter">
              <ScoreMeter
                value={selectedZone.model_risk}
                color={BAND_COLORS[selectedBand]}
                track="#e8e8e8"
              />
              <span className="mzc-meter-val">
                {fmtRiskScore(selectedZone.model_risk)}
                <small>/100</small>
              </span>
            </div>
            <span className="mzc-meter-cap">Conflict pressure (forecast)</span>
          </div>

          <div className="mzc-stats">
            <div className="mzc-stat">
              <span className="mzc-stat-val">{fmtCompact(selectedZone.population)}</span>
              <span className="mzc-stat-lbl">People</span>
            </div>
            <div className="mzc-stat">
              <span className="mzc-stat-val">{fmtCompact(selectedZone.idps)}</span>
              <span className="mzc-stat-lbl">Displaced</span>
            </div>
            <div className="mzc-stat">
              <span className="mzc-stat-val">
                {selectedZone.verified_field_reports_recent ?? 0}
              </span>
              <span className="mzc-stat-lbl">Verified reports</span>
            </div>
            <div className="mzc-stat">
              <span className="mzc-stat-val">{selectedZone.active_hazards ?? 0}</span>
              <span className="mzc-stat-lbl">Active hazards</span>
            </div>
          </div>

          <p className="mzc-forecast">
            Forecast ·{' '}
            {fmtForecastWindow(
              selectedSituationProps?.window_start,
              selectedSituationProps?.window_end,
              selectedSituationProps?.horizon_dekads,
            )}
          </p>

          <details className="mzc-tech">
            <summary>Technical detail</summary>
            <dl>
              <div>
                <dt>Model risk</dt>
                <dd>{fmtRisk(selectedZone.model_risk)}</dd>
              </div>
              <div>
                <dt>IPC phase</dt>
                <dd>{selectedZone.ipc_phase ?? '—'}</dd>
              </div>
              <div>
                <dt>Health alerts</dt>
                <dd>{selectedZone.active_health_alerts ?? 0}</dd>
              </div>
              <div>
                <dt>Operational band</dt>
                <dd><BandChip band={selectedZone.operational_band} /></dd>
              </div>
            </dl>
          </details>

          <div className="mzc-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void navigate(`/zones/${selectedZone.zone_id}`)}
            >
              Open dossier →
            </button>
            {selectedZone.situation_id ? (
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() =>
                    void navigate(`/situations/${selectedZone.situation_id}`)
                  }
                >
                  View situation
                </button>
                <button
                  type="button"
                  className="button button-secondary"
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
