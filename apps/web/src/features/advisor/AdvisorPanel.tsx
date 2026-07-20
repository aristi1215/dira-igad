import { useMutation, useQueryClient } from '@tanstack/react-query'
import { approveAlert, queryKeys } from '../../lib/api'
import type { Alert } from '../../lib/types'

type AdvisorPanelProps = {
  alerts: Alert[] | undefined
  isLoading: boolean
  error: Error | null
}

export function AdvisorPanel({ alerts, isLoading, error }: AdvisorPanelProps) {
  const queryClient = useQueryClient()
  const approveMutation = useMutation({
    mutationFn: (alertId: string) => approveAlert(alertId),
    onSuccess: (response) => {
      queryClient.setQueryData<Alert[]>(
        queryKeys.pendingAlerts,
        (current = []) => current.filter((alert) => alert.id !== response.id),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries })
    },
  })

  const pendingAlerts = alerts ?? []

  return (
    <section className="queue-panel panel-fade">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Advisor gate</p>
          <h2>Pending alerts</h2>
        </div>
        <span className="count-pill">{pendingAlerts.length}</span>
      </div>

      {isLoading ? <p className="muted">Loading pending alerts...</p> : null}
      {error ? (
        <p className="error-note">
          Pending alert list is unavailable: {error.message}
        </p>
      ) : null}

      <div className="queue-list">
        {pendingAlerts.map((alert) => (
          <article className="queue-item" key={alert.id}>
            <div>
              <strong>{alert.language.toUpperCase()} alert</strong>
              <p>{alert.body_text}</p>
              <small>Situation {shortId(alert.situation_id)}</small>
            </div>
            <button
              className="button button-primary"
              type="button"
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate(alert.id)}
            >
              Approve
            </button>
          </article>
        ))}
      </div>

      {!isLoading && !error && pendingAlerts.length === 0 ? (
        <p className="muted">No alerts are waiting for approval.</p>
      ) : null}
    </section>
  )
}

function shortId(id: string): string {
  return id.slice(0, 8)
}
