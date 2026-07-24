import { useQuery } from '@tanstack/react-query'
import { fetchZoneSignals, queryKeys } from '../../lib/api'

type SignalsListProps = {
  zoneId: string | null
}

export function SignalsList({ zoneId }: SignalsListProps) {
  const signalsQuery = useQuery({
    queryKey: queryKeys.zoneSignals(zoneId ?? 'none'),
    queryFn: () => fetchZoneSignals(zoneId ?? ''),
    enabled: zoneId != null,
  })

  if (!zoneId) return null
  const signals = signalsQuery.data ?? []

  return (
    <div className="signals-panel" aria-label="News signals">
      {signalsQuery.isLoading ? <p className="loading-note">Loading signals…</p> : null}
      {!signalsQuery.isLoading && signals.length === 0 ? (
        <p className="empty-state">No news signals for this zone.</p>
      ) : null}
      <ul className="signals-list">
        {signals.slice(0, 6).map((signal) => (
          <li key={signal.id}>
            <div className="signal-head">
              <span className="signal-type">
                {signal.signal_type.replaceAll('_', ' ')}
              </span>
              <span className={`status-pill status-${signal.status}`}>
                {signal.status}
              </span>
              <strong>{Math.round(signal.confidence * 100)}%</strong>
            </div>
            {signal.title ? <p className="signal-title">{signal.title}</p> : null}
            {signal.source ? <small className="muted">{signal.source}</small> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
