/** Tabiri impact card: frozen exposure + explanation + [See why] SHAP + [Prepare alert]. */
import { useState } from 'react'

import { useSituationDetail } from '../../hooks/queries'
import { BAND_COLOR } from '../../lib/color'
import type { OperationalBand } from '../../lib/types'

interface Props {
  situationId: string
  exposedPopulation: number | null
  onPrepareAlert: () => void
  preparing: boolean
}

export function TabiriCard({ situationId, exposedPopulation, onPrepareAlert, preparing }: Props) {
  const { data, isLoading } = useSituationDetail(situationId)
  const [showWhy, setShowWhy] = useState(false)

  if (isLoading || !data) return <div className="card">Loading situation…</div>
  const latest = data.assessments[data.assessments.length - 1]
  const band = latest.operational_band as OperationalBand
  const topShap = Object.entries(latest.shap)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)

  return (
    <div className="card">
      <div className="card-head">
        <h2>{data.zone_name}</h2>
        <span className="band-chip" style={{ background: BAND_COLOR[band] }}>
          {band.toUpperCase()}
        </span>
      </div>
      <p className="muted">
        {data.country} · {data.hazard_type} · status {data.status}
      </p>

      <div className="stat-grid">
        <div>
          <span className="stat-label">Model risk</span>
          <span className="stat-value">{(latest.model_risk * 100).toFixed(0)}%</span>
        </div>
        <div>
          <span className="stat-label">Corroboration</span>
          <span className="stat-value">{(latest.corroboration * 100).toFixed(0)}%</span>
        </div>
        <div>
          <span className="stat-label">Exposed population</span>
          {/* Frozen at assessment time (exposure snapshot). */}
          <span className="stat-value">
            {exposedPopulation !== null ? exposedPopulation.toLocaleString() : '—'}
          </span>
        </div>
      </div>

      <p className="explanation">{latest.explanation}</p>
      <p className="rule">Rule: {latest.combination_rule}</p>

      <div className="card-actions">
        <button className="btn ghost" onClick={() => setShowWhy((s) => !s)}>
          {showWhy ? 'Hide why' : 'See why'}
        </button>
        <button className="btn primary" onClick={onPrepareAlert} disabled={preparing}>
          {preparing ? 'Preparing…' : 'Prepare alert'}
        </button>
      </div>

      {showWhy && (
        <ul className="shap-list">
          {topShap.map(([name, value]) => (
            <li key={name}>
              <span>{name}</span>
              <span className={value > 0 ? 'up' : 'down'}>{value.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}

      <RiskTimeline points={data.assessments.map((a) => a.model_risk)} />
    </div>
  )
}

function RiskTimeline({ points }: { points: number[] }) {
  if (points.length < 2) return null
  return (
    <div className="timeline">
      <span className="stat-label">Risk timeline</span>
      <div className="spark">
        {points.map((p, i) => (
          <span key={i} className="bar" style={{ height: `${Math.round(p * 100)}%` }} />
        ))}
      </div>
    </div>
  )
}
