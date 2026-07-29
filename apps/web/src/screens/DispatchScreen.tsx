import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleCheck,
  CircleX,
  Clock,
  Inbox,
  Lock,
  PhoneOutgoing,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import {
  approveAlert,
  fetchDeliveries,
  fetchPendingAlerts,
  fetchRecipients,
  queryKeys,
  retryDelivery,
} from '../lib/api'
import { BAND_MAP_COLORS, fmtDateTime, fmtForecastWindow, titleCase } from '../lib/format'
import {
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Kbd,
  PageHeader,
  Screen,
  SkeletonText,
  Stat,
  StatRow,
  StatusChip,
  TextInput,
} from '../components/ui'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'
import { useJustUpdated } from '../stores/live'
import { cx } from '../lib/cx'
import type { Alert, Delivery, DeliveryStatus } from '../lib/types'

/**
 * A delivery row that flashes once when SSE reports it changed — so a call
 * moving from queued to delivered while you are looking at the board is
 * visible, without anything blinking permanently.
 */
function DeliveryCard({
  delivery,
  children,
}: {
  delivery: Delivery
  children: ReactNode
}) {
  const justUpdated = useJustUpdated(delivery.id)
  return (
    <li
      className={cx(
        'rounded-sm border border-line bg-surface-2 px-2 py-1.5',
        justUpdated && 'animate-flash-ring',
      )}
    >
      {children}
    </li>
  )
}

const BOARD_COLUMNS: { status: DeliveryStatus; label: string; icon: LucideIcon; tint: string }[] = [
  { status: 'queued', label: 'Queued', icon: Clock, tint: 'text-faint' },
  { status: 'sending', label: 'Calling', icon: PhoneOutgoing, tint: 'text-info-fg' },
  { status: 'sent', label: 'Sent', icon: Send, tint: 'text-info-fg' },
  { status: 'delivered', label: 'Delivered', icon: CircleCheck, tint: 'text-ok-fg' },
  { status: 'failed', label: 'Failed', icon: CircleX, tint: 'text-err-fg' },
  { status: 'needs_review', label: 'Needs review', icon: TriangleAlert, tint: 'text-warn-fg' },
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
      queryClient.setQueryData<Alert[]>(queryKeys.pendingAlerts, (current = []) =>
        current.filter((alert) => alert.id !== response.id),
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

  const deliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data])
  const byStatus = useMemo(() => {
    const groups = new Map<DeliveryStatus, Delivery[]>()
    for (const column of BOARD_COLUMNS) {
      groups.set(column.status, [])
    }
    for (const delivery of deliveries) {
      groups.get(delivery.status)?.push(delivery)
    }
    return groups
  }, [deliveries])

  const acked = deliveries.filter((delivery) => delivery.ack_status !== 'none').length
  const needsReview = byStatus.get('needs_review')?.length ?? 0
  const pendingAlerts = alertsQuery.data ?? []
  const canApprove = signer.trim().length > 1

  // One alert at a time: approving a voice call that will ring real phones
  // deserves undivided attention, not a scrollable stack.
  const [current, ...queued] = pendingAlerts
  const recipients = recipientsQuery.data ?? []
  const recipientsForCurrent = current?.zone_id
    ? recipients.filter((recipient) => recipient.zone_id === current.zone_id && recipient.active)
    : recipients.filter((recipient) => recipient.active)

  return (
    <Screen>
      <PageHeader
        eyebrow="Dispatch console"
        title="Approve and send"
        description="Alerts leave this room only through a named human. The database itself refuses any delivery without an approver, and approval queues every recipient in the same transaction."
      />

      <StatRow className="mb-5">
        <Stat
          label="Waiting on you"
          value={pendingAlerts.length}
          detail="Drafted, not yet approved"
          accent={BAND_MAP_COLORS.watch}
        />
        <Stat
          label="Delivered"
          value={byStatus.get('delivered')?.length ?? 0}
          detail={`of ${deliveries.length} calls`}
          accent={BAND_MAP_COLORS.ack}
        />
        <Stat
          label="Acknowledged"
          value={acked}
          detail="Recipient pressed a key"
          accent={BAND_MAP_COLORS.ack}
        />
        <Stat
          label="Needs review"
          value={needsReview}
          detail="Never retried automatically"
          accent={BAND_MAP_COLORS.high}
        />
      </StatRow>

      <Card
        title="The human gate"
        subtitle="Read the message as the recipient will hear it, then approve in your own name."
        className="mb-5"
        actions={
          queued.length > 0 ? (
            <span className="text-2xs text-faint">{queued.length} more waiting</span>
          ) : null
        }
      >
        <div data-tour={TOUR_ANCHORS.approvalGate}>
          {alertsQuery.isLoading ? <SkeletonText lines={4} /> : null}
          {alertsQuery.isError ? <ErrorNote error={alertsQuery.error} /> : null}
          {approveMutation.isError ? (
            <ErrorNote error={approveMutation.error} className="mb-3" />
          ) : null}

          {current ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusChip tone="warning">Pending approval</StatusChip>
                <span className="text-sm font-semibold text-ink">
                  {current.zone_name ?? 'Voice alert'}
                </span>
                <span className="text-2xs text-faint">
                  {current.language.toUpperCase()} voice call · drafted{' '}
                  {fmtDateTime(current.created_at)}
                </span>
              </div>

              {/* The alert body is the product. It gets to be the biggest thing here. */}
              <blockquote className="rounded-md border border-line border-l-[3px] border-l-accent bg-surface-2 px-4 py-3 text-md leading-relaxed text-ink">
                {current.body_text}
              </blockquote>

              {current.window_start && current.window_end ? (
                <p className="mt-2 text-xs text-faint">
                  Forecast window: {fmtForecastWindow(current.window_start, current.window_end)}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <Field label="Approved by" htmlFor="approver" className="w-60">
                  <TextInput
                    id="approver"
                    value={signer}
                    placeholder="Your full name"
                    autoComplete="name"
                    onChange={(event) => setSigner(event.target.value)}
                  />
                </Field>
                <Button
                  variant="primary"
                  icon={PhoneOutgoing}
                  disabled={!canApprove}
                  loading={approveMutation.isPending}
                  title={canApprove ? undefined : 'Enter your name first'}
                  onClick={() => approveMutation.mutate(current.id)}
                  className="mb-0.5"
                >
                  {approveMutation.isPending
                    ? 'Approving…'
                    : `Approve & queue ${recipientsForCurrent.length} call${
                        recipientsForCurrent.length === 1 ? '' : 's'
                      }`}
                </Button>
                <p className="mb-2 flex items-center gap-1.5 text-2xs text-faint">
                  <Lock size={11} strokeWidth={1.75} aria-hidden />
                  Recorded with your name and a timestamp
                </p>
              </div>
            </>
          ) : !alertsQuery.isLoading ? (
            <EmptyState icon={Inbox} title="Nothing waiting at the gate">
              Draft an alert from the map or a situation page and it will appear here.
            </EmptyState>
          ) : null}
        </div>
      </Card>

      <Card
        title="Delivery board"
        subtitle="Claim, place the call outside any transaction, then record the result. Stuck calls become needs-review — never a silent retry."
        className="mb-5"
        padded={false}
      >
        {deliveriesQuery.isError ? (
          <ErrorNote error={deliveriesQuery.error} className="m-4" />
        ) : null}
        {retryMutation.isError ? <ErrorNote error={retryMutation.error} className="m-4" /> : null}

        <div className="grid grid-cols-2 gap-px overflow-x-auto bg-line md:grid-cols-3 xl:grid-cols-6">
          {BOARD_COLUMNS.map((column) => {
            const items = byStatus.get(column.status) ?? []
            const Icon = column.icon
            return (
              <section key={column.status} className="min-w-0 bg-surface p-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
                  <Icon size={13} strokeWidth={1.75} aria-hidden className={column.tint} />
                  {column.label}
                  <span className="ml-auto text-sm font-semibold tabular-nums text-ink">
                    {items.length}
                  </span>
                </h3>

                <ul className="flex flex-col gap-1.5">
                  {items.slice(0, 12).map((delivery) => (
                    <DeliveryCard key={delivery.id} delivery={delivery}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-2xs font-medium text-ink">{delivery.channel}</span>
                        {delivery.ack_status !== 'none' ? (
                          <StatusChip tone="success" className="ml-auto">
                            {titleCase(delivery.ack_status)}
                          </StatusChip>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-2xs text-faint">
                        {delivery.attempt_count} attempt
                        {delivery.attempt_count === 1 ? '' : 's'} ·{' '}
                        {fmtDateTime(delivery.updated_at)}
                      </p>
                      {delivery.last_error ? (
                        <p className="mt-1 text-2xs break-words text-err-fg">
                          {delivery.last_error}
                        </p>
                      ) : null}
                      {delivery.status === 'needs_review' ? (
                        <Button
                          size="sm"
                          className="mt-1.5"
                          loading={retryMutation.isPending}
                          onClick={() => retryMutation.mutate(delivery.id)}
                        >
                          Retry
                        </Button>
                      ) : null}
                    </DeliveryCard>
                  ))}
                  {items.length === 0 ? (
                    <li className="py-1 text-2xs text-faint">None</li>
                  ) : null}
                  {items.length > 12 ? (
                    <li className="py-1 text-2xs text-faint">
                      +{items.length - 12} more
                    </li>
                  ) : null}
                </ul>
              </section>
            )
          })}
        </div>
      </Card>

      <Card title="Reference" subtitle="How recipients answer, and who is on the list">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div>
            <h3 className="mb-2 text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
              Keypad acknowledgements
            </h3>
            <ul className="flex flex-col gap-2">
              {[
                { key: '1', title: 'Acknowledged', body: 'Message heard and understood' },
                { key: '2', title: 'Conflict reported', body: 'It is already active where they are' },
                { key: '3', title: 'Resolved', body: 'The local situation has calmed' },
              ].map((entry) => (
                <li key={entry.key} className="flex items-start gap-2.5">
                  <Kbd className="mt-0.5">{entry.key}</Kbd>
                  <span className="text-xs">
                    <span className="font-medium text-ink">{entry.title}</span>
                    <span className="block text-faint">{entry.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Callout tone="info" className="mt-3">
              Acknowledgements arrive by provider webhook and are idempotent — a repeated
              callback never double-counts.
            </Callout>
          </div>

          <div className="min-w-0">
            <h3 className="mb-2 text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
              Recipient roster
            </h3>
            {recipientsQuery.isLoading ? <SkeletonText lines={4} /> : null}
            {recipientsQuery.isError ? <ErrorNote error={recipientsQuery.error} /> : null}
            {recipients.length > 0 ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line">
                      {['Name', 'Zone', 'Phone', 'Lang'].map((header) => (
                        <th
                          key={header}
                          scope="col"
                          className="px-2 py-1.5 text-left text-2xs font-medium tracking-[0.04em] text-muted uppercase"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((recipient) => (
                      <tr key={recipient.id} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-1.5 text-ink">{recipient.name}</td>
                        <td className="px-2 py-1.5 text-faint">
                          {recipient.zone_name ?? recipient.zone_id}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-2xs text-muted">
                          {recipient.phone_e164}
                        </td>
                        <td className="px-2 py-1.5 text-muted">
                          {recipient.language.toUpperCase()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !recipientsQuery.isLoading ? (
              <EmptyState>No recipients registered.</EmptyState>
            ) : null}
          </div>
        </div>
      </Card>
    </Screen>
  )
}
