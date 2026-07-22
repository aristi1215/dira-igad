import { useMemo } from 'react'
import type { SituationFeatureCollection } from '../../lib/types'
import { useMapUiStore } from '../../stores/mapUi'

type ZoneQueueProps = {
  situations: SituationFeatureCollection | undefined
  isLoading: boolean
}

export function ZoneQueue({ situations, isLoading }: ZoneQueueProps) {
  const selectedSituationId = useMapUiStore((state) => state.selectedSituationId)
  const setSelectedZoneId = useMapUiStore((state) => state.setSelectedZoneId)
  const setSelectedSituationId = useMapUiStore(
    (state) => state.setSelectedSituationId,
  )

  const ranked = useMemo(() => {
    const features = situations?.features ?? []
    return [...features].sort(
      (a, b) => (b.properties.model_risk ?? 0) - (a.properties.model_risk ?? 0),
    )
  }, [situations])

  return (
    <section className="zone-queue panel-fade" aria-label="Conflict pressure queue">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Amani watchlist</p>
          <h2>Zones by pressure</h2>
        </div>
        <span className="count-pill">{ranked.length}</span>
      </div>

      {isLoading ? <p className="muted">Loading zones...</p> : null}

      <div className="queue-scroll">
        {ranked.map((feature) => {
          const p = feature.properties
          const risk = Math.round((p.model_risk ?? 0) * 100)
          const active = p.situation_id === selectedSituationId
          return (
            <button
              key={p.situation_id}
              type="button"
              className={active ? 'zone-row active' : 'zone-row'}
              onClick={() => {
                setSelectedZoneId(p.zone_id)
                setSelectedSituationId(p.situation_id)
              }}
            >
              <span className="zone-row-main">
                <strong>{p.zone_name}</strong>
                <small>
                  {p.country_iso2} · corroboration{' '}
                  {Math.round((p.corroboration ?? 0) * 100)}%
                </small>
              </span>
              <span className="zone-row-risk">
                <span className={`band-pill band-${p.operational_band ?? 'none'}`}>
                  {(p.operational_band ?? 'n/a').replaceAll('_', ' ')}
                </span>
                <strong className="risk-index">{risk}</strong>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
