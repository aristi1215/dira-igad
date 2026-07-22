import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { prepareAlert, queryKeys } from '../../lib/api'
import type { Alert, SituationFeature } from '../../lib/types'

type TabiriCardProps = {
  feature: SituationFeature | null
}

const OPEN_BANDS = new Set(['high', 'very_high'])

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
      .slice(0, 5)
  }, [feature])

  if (!feature) {
    return (
      <section className="tabiri-card panel-fade">
        <p className="eyebrow">Tabiri impact card</p>
        <h2>Select a zone</h2>
        <p className="muted">
          Choose an operational zone on the map or from the watchlist to inspect
          risk, exposure, drivers, and advisor actions.
        </p>
      </section>
    )
  }

  const { properties } = feature
  const modelRisk = properties.model_risk ?? 0
  const corroboration = properties.corroboration ?? 0
  const riskIndex = Math.round(modelRisk * 100)
  const triggerEligible = OPEN_BANDS.has(properties.operational_band ?? '')

  return (
    <section className="tabiri-card panel-fade" aria-live="polite">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Tabiri impact card</p>
          <h2>{properties.zone_name}</h2>
          <small className="muted">
            {properties.country_iso2} · cycle {properties.cycle ?? 'n/a'}
          </small>
        </div>
        <div className="risk-badge">
          <strong>{riskIndex}</strong>
          <span className={`band-pill band-${properties.operational_band ?? 'none'}`}>
            {formatBand(properties.operational_band)}
          </span>
        </div>
      </div>

      <div className="score-bars">
        <ScoreBar label="Model risk (climate + history)" value={modelRisk} />
        <ScoreBar label="News corroboration" value={corroboration} />
      </div>

      <div className={triggerEligible ? 'trigger-row armed' : 'trigger-row'}>
        <span className="trigger-dot" />
        {triggerEligible
          ? 'Trigger active — band ≥ high, alert drafting enabled'
          : 'Below trigger — monitoring only'}
      </div>

      <dl className="metric-grid">
        <Metric label="Population" value={formatNumber(properties.exposure_snapshot.population)} />
        <Metric
          label="Pastoralist share"
          value={formatPercent(properties.exposure_snapshot.pastoralist_share)}
        />
        <Metric label="Water points" value={formatNumber(properties.exposure_snapshot.water_points)} />
        <Metric label="Markets" value={formatNumber(properties.exposure_snapshot.markets)} />
        <Metric
          label="Conflict probability"
          value={formatPercent(properties.prob_conflict ?? undefined)}
        />
        <Metric
          label="Expected incidents"
          value={
            properties.expected_incidents != null
              ? properties.expected_incidents.toFixed(1)
              : 'n/a'
          }
        />
      </dl>

      <div className="explanation-block">
        <h3>Why this assessment</h3>
        <p>{properties.explanation ?? 'No explanation is available yet.'}</p>
      </div>

      {shapEntries.length > 0 ? (
        <div className="drivers-block">
          <h3>Risk drivers</h3>
          <ul className="drivers-list">
            {shapEntries.map(([name, value]) => (
              <li key={name}>
                <span>{labelize(name)}</span>
                <span className="driver-bar">
                  <span
                    style={{
                      width: `${Math.min(100, Math.abs(value) * 100 * 3)}%`,
                    }}
                  />
                </span>
                <strong>{value.toFixed(3)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setShowWhy((current) => !current)}
        >
          {showWhy ? 'Hide rule' : 'Combination rule'}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={prepareMutation.isPending || !triggerEligible}
          onClick={() => prepareMutation.mutate(properties.situation_id)}
        >
          {prepareMutation.isPending ? 'Preparing...' : 'Prepare alert'}
        </button>
      </div>

      {prepareMutation.isSuccess ? (
        <p className="success-note">Alert drafted — waiting for human approval.</p>
      ) : null}
      {prepareMutation.isError ? (
        <p className="error-note">{errorMessage(prepareMutation.error)}</p>
      ) : null}

      {showWhy ? (
        <div className="shap-panel">
          <h3>Score combination</h3>
          <p className="rule-text">
            {properties.combination_rule ?? 'No combination rule recorded.'}
          </p>
        </div>
      ) : null}
    </section>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="score-bar">
      <div className="score-bar-head">
        <span>{label}</span>
        <strong>{Math.round(value * 100)}%</strong>
      </div>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
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
