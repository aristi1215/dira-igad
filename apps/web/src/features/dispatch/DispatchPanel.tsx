import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys, retryDelivery } from '../../lib/api'
import type { Delivery } from '../../lib/types'

type DispatchPanelProps = {
  deliveries: Delivery[] | undefined
  isLoading: boolean
  error: Error | null
}

export function DispatchPanel({
  deliveries,
  isLoading,
  error,
}: DispatchPanelProps) {
  const queryClient = useQueryClient()
  const retryMutation = useMutation({
    mutationFn: (deliveryId: string) => retryDelivery(deliveryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries })
    },
  })

  const latestDeliveries = (deliveries ?? []).slice(0, 8)

  return (
    <section className="queue-panel panel-fade">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Onya dispatch</p>
          <h2>Deliveries</h2>
        </div>
        <span className="count-pill">{deliveries?.length ?? 0}</span>
      </div>

      {isLoading ? <p className="muted">Loading deliveries...</p> : null}
      {error ? (
        <p className="error-note">Delivery list is unavailable: {error.message}</p>
      ) : null}

      <div className="queue-list compact">
        {latestDeliveries.map((delivery) => (
          <article className="queue-item dispatch-item" key={delivery.id}>
            <div>
              <strong>{delivery.channel}</strong>
              <p>
                <StatusPill value={delivery.status} /> Ack:{' '}
                <span>{delivery.ack_status}</span>
              </p>
              <small>
                Attempts {delivery.attempt_count} - Updated{' '}
                {formatDate(delivery.updated_at)}
              </small>
              {delivery.last_error ? (
                <small className="error-text">{delivery.last_error}</small>
              ) : null}
            </div>
            {delivery.status === 'needs_review' ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate(delivery.id)}
              >
                Retry
              </button>
            ) : null}
          </article>
        ))}
      </div>

      {!isLoading && !error && latestDeliveries.length === 0 ? (
        <p className="muted">No deliveries have been created yet.</p>
      ) : null}
    </section>
  )
}

function StatusPill({ value }: { value: string }) {
  return <span className={`status-pill status-${value}`}>{value}</span>
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
