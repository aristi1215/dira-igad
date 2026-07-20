import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { prepareAlert, queryKeys } from '../../lib/api'
import type { Alert, SituationFeature } from '../../lib/types'

type TabiriCardProps = {
  feature: SituationFeature | null
}

export function TabiriCard({ feature }: TabiriCardProps) {
  const [showWhy, setShowWhy] = useState(false)
  const queryClient = useQueryClient()
  const prepareMutation = useMutation({
    mutationFn: (situationId: string) => prepareAlert(situationId),
    onSuccess: (alert) => {
      queryClient.setQueryData<Alert[]>(
        queryKeys.pendingAlerts,
        (current = []) => [
          alert,
          ...current.filter((item) => item.id !== alert.id),
        ],
      )
    },
  })

  const shapEntries = useMemo(() => {
    if (!feature) {
      return []
    }

    return Object.entries(feature.properties.shap)
      .sort(([, left], [, right]) => Math.abs(right) - Math.abs(left))
      .slice(0, 6)
  }, [feature])

  if (!feature) {
    return (
      <section className="tabiri-card panel-fade">
        <p className="eyebrow">Tabiri impact card</p>
        <h2>Select a zone</h2>
        <p className="muted">
          Choose an operational zone on the map to inspect exposure, model
          explanation, and advisor actions.
        </p>
      </section>
    )
  }

  const { properties } = feature

  return (
    <section className="tabiri-card panel-fade" aria-live="polite">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Tabiri impact card</p>
          <h2>{properties.zone_name}</h2>
        </div>
        <span className={`band-pill band-${properties.operational_band ?? 'none'}`}>
          {formatBand(properties.operational_band)}
        </span>
      </div>

      <dl className="metric-grid">
        <Metric label="Population" value={formatNumber(properties.exposure_snapshot.population)} />
        <Metric
          label="Pastoralist share"
          value={formatPercent(properties.exposure_snapshot.pastoralist_share)}
        />
        <Metric label="Water points" value={formatNumber(properties.exposure_snapshot.water_points)} />
        <Metric label="Markets" value={formatNumber(properties.exposure_snapshot.markets)} />
      </dl>

      <div className="explanation-block">
        <h3>Explanation</h3>
        <p>{properties.explanation ?? 'No explanation is available yet.'}</p>
      </div>

      <div className="card-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setShowWhy((current) => !current)}
        >
          {showWhy ? 'Hide why' : 'See why'}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={prepareMutation.isPending}
          onClick={() => prepareMutation.mutate(properties.situation_id)}
        >
          {prepareMutation.isPending ? 'Preparing...' : 'Prepare alert'}
        </button>
      </div>

      {prepareMutation.isSuccess ? (
        <p className="success-note">Alert drafted for advisor approval.</p>
      ) : null}
      {prepareMutation.isError ? (
        <p className="error-note">{errorMessage(prepareMutation.error)}</p>
      ) : null}

      {showWhy ? (
        <div className="shap-panel">
          <h3>SHAP breakdown</h3>
          {shapEntries.length > 0 ? (
            <ul>
              {shapEntries.map(([name, value]) => (
                <li key={name}>
                  <span>{labelize(name)}</span>
                  <strong>{value.toFixed(3)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No SHAP values were returned for this zone.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatBand(value: string | null): string {
  return value ? labelize(value) : 'None'
}

function labelize(value: string): string {
  return value.replaceAll('_', ' ')
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : 'Not reported'
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : 'Not reported'
}

function errorMessage(error: Error | null): string {
  return error?.message ?? 'The request failed.'
}
