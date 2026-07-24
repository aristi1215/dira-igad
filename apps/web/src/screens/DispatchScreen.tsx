import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveAlert,
  fetchDeliveries,
  fetchPendingAlerts,
  fetchRecipients,
  queryKeys,
  retryDelivery,
} from '../lib/api'
import { BAND_MAP_COLORS, fmtDateTime, titleCase } from '../lib/format'
import {
  Card,
  EmptyState,
  ErrorNote,
  LoadingNote,
  PageHeader,
  StatTile,
  StatusChip,
} from '../components/ui'
import type { Alert, Delivery, DeliveryStatus } from '../lib/types'

const BOARD_COLUMNS: DeliveryStatus[] = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'needs_review',
]

export function DispatchScreen() {
  const queryClient = useQueryClient()
  const [signer, setSigner] = useState('')

  const alertsQuery = useQuery({
    queryKey: queryKeys.pendingAlerts,
    queryFn: fetchPendingAlerts,
    retry: 1,
  })
  const deliveriesQuery = useQuery({
    queryKey: queryKeys.deliveries,
    queryFn: fetchDeliveries,
  })
  const recipientsQuery = useQuery({
    queryKey: queryKeys.recipients,
    queryFn: fetchRecipients,
  })

  const approveMutation = useMutation({
    mutationFn: (alertId: string) => approveAlert(alertId, signer.trim()),
    onSuccess: (response) => {
      queryClient.setQueryData<Alert[]>(
        queryKeys.pendingAlerts,
        (current = []) => current.filter((alert) => alert.id !== response.id),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries })
      void queryClient.invalidateQueries({ queryKey: queryKeys.allAlerts })
    },
  })
  const retryMutation = useMutation({
    mutationFn: (deliveryId: string) => retryDelivery(deliveryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries })
    },
  })

  const deliveries = useMemo(
    () => deliveriesQuery.data ?? [],
    [deliveriesQuery.data],
  )
  const byStatus = useMemo(() => {
    const groups = new Map<DeliveryStatus, Delivery[]>()
    for (const status of BOARD_COLUMNS) {
      groups.set(status, [])
    }
    for (const delivery of deliveries) {
      groups.get(delivery.status)?.push(delivery)
    }
    return groups
  }, [deliveries])

  const acked = deliveries.filter((d) => d.ack_status !== 'none').length
  const needsReview = byStatus.get('needs_review')?.length ?? 0
  const pendingAlerts = alertsQuery.data ?? []
  const canApprove = signer.trim().length > 1

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Onya console"
        title="Dispatch"
        description="Alerts leave this room only through the human gate: the database refuses any dispatch without a named approver, and approval atomically queues one delivery per recipient."
      />

      <div className="stat-row">
        <StatTile
          label="Pending approval"
          value={pendingAlerts.length}
          accent={BAND_MAP_COLORS.watch}
        />
        <StatTile label="Deliveries" value={deliveries.length} />
        <StatTile
          label="Delivered"
          value={byStatus.get('delivered')?.length ?? 0}
          accent={BAND_MAP_COLORS.ack}
        />
        <StatTile label="Acknowledged" value={acked} accent={BAND_MAP_COLORS.ack} />
        <StatTile
          label="Needs review"
          value={needsReview}
          detail="No auto-retry — human decision"
          accent={BAND_MAP_COLORS.high}
        />
      </div>

      <Card
        title="Approval gate"
        subtitle="Read the full alert text before approving — approval is recorded with your name and timestamp"
        actions={
          <input
            type="text"
            placeholder="Approver name (required)"
            value={signer}
            onChange={(e) => setSigner(e.target.value)}
          />
        }
      >
        <p className="gate-note">
          The gate is enforced in the database, not the UI: the{' '}
          <span className="mono">alerts</span> table has a CHECK constraint requiring{' '}
          <span className="mono">approved_by</span> and{' '}
          <span className="mono">approved_at</span> before any delivery exists.
        </p>
        {alertsQuery.isLoading ? <LoadingNote /> : null}
        {alertsQuery.isError ? <ErrorNote error={alertsQuery.error} /> : null}
        {approveMutation.isError ? <ErrorNote error={approveMutation.error} /> : null}

        {pendingAlerts.length > 0 ? (
          <div className="stack">
            {pendingAlerts.map((alert) => (
              <article key={alert.id} className="alert-draft">
                <div className="feed-item-head">
                  <StatusChip tone="warning">pending approval</StatusChip>
                  <strong>{alert.language.toUpperCase()} voice alert</strong>
                  <span className="spacer" />
                  <small className="muted">
                    Situation <span className="mono">{alert.situation_id.slice(0, 8)}</span>{' '}
                    · drafted {fmtDateTime(alert.created_at)}
                  </small>
                </div>
                <p className="alert-body-text">{alert.body_text}</p>
                <div className="approve-row">
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!canApprove || approveMutation.isPending}
                    title={canApprove ? undefined : 'Enter your name first'}
                    onClick={() => approveMutation.mutate(alert.id)}
                  >
                    {approveMutation.isPending
                      ? 'Approving…'
                      : `Approve & dispatch${canApprove ? ` as ${signer.trim()}` : ''}`}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : !alertsQuery.isLoading ? (
          <EmptyState>
            Nothing waiting at the gate. Draft alerts from a situation page or the map.
          </EmptyState>
        ) : null}
      </Card>

      <Card
        title="Delivery board"
        subtitle="Two-phase dispatch: claim, call the provider outside any transaction, then record. Stuck sends become needs-review — never silent retries."
      >
        {deliveriesQuery.isLoading ? <LoadingNote /> : null}
        {deliveriesQuery.isError ? <ErrorNote error={deliveriesQuery.error} /> : null}
        {retryMutation.isError ? <ErrorNote error={retryMutation.error} /> : null}
        <div className="delivery-board">
          {BOARD_COLUMNS.map((status) => {
            const items = byStatus.get(status) ?? []
            return (
              <div key={status} className="delivery-column">
                <div className="delivery-column-head">
                  <span>{status.replace('_', ' ')}</span>
                  <span>{items.length}</span>
                </div>
                {items.slice(0, 12).map((delivery) => (
                  <div key={delivery.id} className="delivery-card">
                    <div className="feed-item-head">
                      <strong>{delivery.channel}</strong>
                      <span className="spacer" />
                      {delivery.ack_status !== 'none' ? (
                        <StatusChip tone="success">
                          {titleCase(delivery.ack_status)}
                        </StatusChip>
                      ) : null}
                    </div>
                    <small>
                      Attempts {delivery.attempt_count} · updated{' '}
                      {fmtDateTime(delivery.updated_at)}
                    </small>
                    {delivery.last_error ? (
                      <span className="error-text">{delivery.last_error}</span>
                    ) : null}
                    {delivery.status === 'needs_review' ? (
                      <div>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={retryMutation.isPending}
                          onClick={() => retryMutation.mutate(delivery.id)}
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
                {items.length === 0 ? (
                  <small className="muted" style={{ padding: '0 0.2rem' }}>
                    —
                  </small>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid-2">
        <Card
          title="Keypad acknowledgements"
          subtitle="Recipients answer the voice call and press a key; acks arrive via provider webhooks, idempotently"
        >
          <div className="ack-key">
            <div>
              <kbd>1</kbd>
              <span>
                <strong>Acknowledged</strong> — message heard and understood
              </span>
            </div>
            <div>
              <kbd>2</kbd>
              <span>
                <strong>Conflict reported</strong> — the situation is active where they
                are
              </span>
            </div>
            <div>
              <kbd>3</kbd>
              <span>
                <strong>Resolved</strong> — the local situation has calmed
              </span>
            </div>
          </div>
        </Card>

        <Card title="Recipient roster" subtitle="Community focal points by zone">
          {recipientsQuery.isLoading ? <LoadingNote /> : null}
          {recipientsQuery.isError ? <ErrorNote error={recipientsQuery.error} /> : null}
          {(recipientsQuery.data ?? []).length > 0 ? (
            <div className="table-scroll" style={{ maxHeight: '20rem', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Zone</th>
                    <th>Phone</th>
                    <th>Lang</th>
                  </tr>
                </thead>
                <tbody>
                  {(recipientsQuery.data ?? []).map((recipient) => (
                    <tr key={recipient.id}>
                      <td>{recipient.name}</td>
                      <td className="muted">
                        {recipient.zone_name ?? recipient.zone_id}
                      </td>
                      <td className="mono">{recipient.phone_e164}</td>
                      <td>{recipient.language.toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !recipientsQuery.isLoading ? (
            <EmptyState>No recipients registered.</EmptyState>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
