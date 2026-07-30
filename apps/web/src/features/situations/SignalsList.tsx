import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchZoneSignals, queryKeys } from '../../lib/api'
import { fmtDate, titleCase } from '../../lib/format'
import type { ZoneSignal } from '../../lib/types'
import { SignalDetailModal } from './SignalDetailModal'

type SignalsListProps = {
  zoneId: string | null
  zoneName?: string | null
}

export function SignalsList({ zoneId, zoneName }: SignalsListProps) {
  const [selected, setSelected] = useState<ZoneSignal | null>(null)
  const signalsQuery = useQuery({
    queryKey: queryKeys.zoneSignals(zoneId ?? 'none'),
    queryFn: () => fetchZoneSignals(zoneId ?? ''),
    enabled: zoneId != null,
  })

  if (!zoneId) return null
  const signals = signalsQuery.data ?? []

  return (
    <div className="signals-panel" aria-label="Reports in the news">
      {signalsQuery.isLoading ? <p className="loading-note">Loading reports…</p> : null}
      {!signalsQuery.isLoading && signals.length === 0 ? (
        <p className="empty-state">No reports in the news for this zone.</p>
      ) : null}
      <ul className="signals-list">
        {signals.slice(0, 6).map((signal) => (
          <li key={signal.id}>
            <button
              type="button"
              className="signal-item"
              onClick={() => setSelected(signal)}
            >
              <span className="signal-head">
                <span className="signal-type">{titleCase(signal.signal_type)}</span>
                <span className={`status-pill status-${signal.status}`}>
                  {signal.status}
                </span>
                <strong>{Math.round(signal.confidence * 100)}%</strong>
              </span>
              {signal.title ? <span className="signal-title">{signal.title}</span> : null}
              <small className="muted">
                {[signal.source, signal.published_at ? fmtDate(signal.published_at) : null]
                  .filter(Boolean)
                  .join(' · ') || 'Source pending'}
                {' · click for full context'}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <SignalDetailModal
          signal={selected}
          zoneName={zoneName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  )
}
