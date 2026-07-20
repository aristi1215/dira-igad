/** Onya dispatch panel: delivery statuses, needs_review flag + manual retry. */
import { useDeliveries, useRetryDelivery } from '../../hooks/queries'
import type { DeliveryStatus } from '../../lib/types'

const STATUS_COLOR: Record<DeliveryStatus, string> = {
  queued: '#8a94a6',
  sending: '#f1c40f',
  sent: '#3498db',
  delivered: '#2ecc71',
  failed: '#e74c3c',
  needs_review: '#e67e22',
}

interface Props {
  alertId: string
}

export function DispatchPanel({ alertId }: Props) {
  const { data: deliveries } = useDeliveries(alertId)
  const retry = useRetryDelivery()

  if (!deliveries) return null

  return (
    <div className="card">
      <h3>Dispatch — Onya</h3>
      <ul className="delivery-list">
        {deliveries.map((d) => (
          <li key={d.id}>
            <span className="dot" style={{ background: STATUS_COLOR[d.status] }} />
            <span className="recipient">{d.recipient_name ?? d.phone}</span>
            <span className="status">{d.status}</span>
            {d.ack_status !== 'none' && <span className="ack">ack: {d.ack_status}</span>}
            {d.status === 'needs_review' && (
              <button className="btn ghost sm" onClick={() => retry.mutate(d.id)}>
                Retry
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
