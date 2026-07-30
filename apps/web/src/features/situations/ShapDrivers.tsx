import { useState } from 'react'
import { EmptyState } from '../../components/ui'
import { featureMeta } from '../../lib/explain'
import type { ShapBreakdown } from '../../lib/types'

/**
 * Signed model attribution list: bars diverge from a shared zero line so
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
    <div className="grid gap-2.5">
      <div className="flex gap-4 text-xs text-muted">
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-band-high" /> pushes risk up
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-band-low" /> pushes risk down
        </span>
      </div>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {entries.map(({ feature, value }) => {
          const meta = featureMeta(feature)
          const share = total > 0 ? (Math.abs(value) / total) * 100 : 0
          const isOpen = expanded === feature
          return (
            <li key={feature} className={isOpen ? 'rounded-md bg-surface-2' : ''}>
              <button
                type="button"
                className="grid w-full grid-cols-[minmax(9rem,13rem)_1fr_auto_2.5rem] items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 text-left text-sm text-muted transition-colors hover:border-line hover:bg-surface-2"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : feature)}
              >
                <span className="grid leading-tight text-ink">
                  {meta.label}
                  <small className="text-[0.68rem] uppercase tracking-wide text-muted">{meta.group}</small>
                </span>
                <span className="relative grid h-2 grid-cols-2 overflow-hidden rounded bg-surface-2 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-line-strong" aria-hidden="true">
                  <span className="flex justify-end">
                    {value < 0 ? (
                      <span className="h-full rounded-l bg-band-low" style={{ width: `${(Math.abs(value) / max) * 100}%` }} />
                    ) : null}
                  </span>
                  <span className="flex">
                    {value >= 0 ? (
                      <span className="h-full rounded-r bg-band-high" style={{ width: `${(Math.abs(value) / max) * 100}%` }} />
                    ) : null}
                  </span>
                </span>
                <span className={value >= 0 ? 'font-mono text-err-fg' : 'font-mono text-info-fg'}>
                  {value >= 0 ? '+' : '−'}
                  {Math.abs(value).toFixed(3)}
                </span>
                <span className="font-mono text-muted">{share.toFixed(0)}%</span>
              </button>
              {isOpen ? (
                <p className="m-0 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-xs leading-relaxed text-muted">{meta.description}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="m-0 text-xs leading-relaxed text-faint">
        These attributions explain <em>this prediction</em>: each value is the
        feature’s contribution (in probability points) relative to the model’s
        average output. They describe what the model relied on — not causal proof
        of what will drive events on the ground. The % column is each feature’s
        share of total attribution magnitude.
      </p>
    </div>
  )
}
