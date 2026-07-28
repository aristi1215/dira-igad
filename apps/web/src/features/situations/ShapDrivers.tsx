import { useState } from 'react'
import { EmptyState } from '../../components/ui'
import { featureMeta } from '../../lib/explain'
import type { ShapBreakdown } from '../../lib/types'

/**
 * Signed SHAP attribution list: bars diverge from a shared zero line so
 * risk-raising (+) and risk-lowering (−) drivers read at a glance.
 */
export function ShapDrivers({ shap }: { shap: ShapBreakdown }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const entries = Object.entries(shap)
    .map(([feature, value]) => ({ feature, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  if (entries.length === 0) {
    return <EmptyState>No driver attribution available.</EmptyState>
  }

  const max = Math.max(0.001, ...entries.map((e) => Math.abs(e.value)))
  const total = entries.reduce((sum, e) => sum + Math.abs(e.value), 0)

  return (
    <div className="shap-panel">
      <div className="shap-legend">
        <span>
          <span className="shap-swatch shap-swatch-pos" /> pushes risk up
        </span>
        <span>
          <span className="shap-swatch shap-swatch-neg" /> pushes risk down
        </span>
      </div>
      <ul className="shap-list">
        {entries.map(({ feature, value }) => {
          const meta = featureMeta(feature)
          const share = total > 0 ? (Math.abs(value) / total) * 100 : 0
          const isOpen = expanded === feature
          return (
            <li key={feature} className={isOpen ? 'shap-row open' : 'shap-row'}>
              <button
                type="button"
                className="shap-row-button"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : feature)}
              >
                <span className="shap-name">
                  {meta.label}
                  <small className="muted">{meta.group}</small>
                </span>
                <span className="shap-bar" aria-hidden="true">
                  <span className="shap-bar-neg">
                    {value < 0 ? (
                      <span style={{ width: `${(Math.abs(value) / max) * 100}%` }} />
                    ) : null}
                  </span>
                  <span className="shap-bar-pos">
                    {value >= 0 ? (
                      <span style={{ width: `${(Math.abs(value) / max) * 100}%` }} />
                    ) : null}
                  </span>
                </span>
                <span className={value >= 0 ? 'shap-value pos' : 'shap-value neg'}>
                  {value >= 0 ? '+' : '−'}
                  {Math.abs(value).toFixed(3)}
                </span>
                <span className="shap-share muted">{share.toFixed(0)}%</span>
              </button>
              {isOpen ? (
                <p className="shap-description">{meta.description}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="shap-footnote">
        TreeSHAP attributions explain <em>this prediction</em>: each value is the
        feature’s contribution (in probability points) relative to the model’s
        average output. They describe what the model relied on — not causal proof
        of what will drive events on the ground. The % column is each feature’s
        share of total attribution magnitude.
      </p>
    </div>
  )
}
