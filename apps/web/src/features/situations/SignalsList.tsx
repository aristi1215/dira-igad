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
    <section className="signals-panel panel-fade" aria-label="News signals">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">News corroboration</p>
          <h2>Signals</h2>
        </div>
        <span className="count-pill">{signals.length}</span>
      </div>
      {signalsQuery.isLoading ? <p className="muted">Loading signals...</p> : null}
      {!signalsQuery.isLoading && signals.length === 0 ? (
        <p className="muted">No news signals for this zone.</p>
      ) : null}
      <ul className="signals-list">
        {signals.slice(0, 5).map((signal) => (
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
    </section>
  )
}
