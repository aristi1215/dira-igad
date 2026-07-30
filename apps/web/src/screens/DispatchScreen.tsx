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
  DataTable,
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
  type Column,
} from '../components/ui'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'
import { useJustUpdated } from '../stores/live'
import { cx } from '../lib/cx'
import type { Alert, Delivery, DeliveryStatus, Recipient } from '../lib/types'

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

/**
 * `bar` is a full literal class name, not an interpolation: Tailwind's scanner
 * cannot see `bg-${x}` and would emit no CSS at all, silently.
 */
const BOARD_COLUMNS: {
  status: DeliveryStatus
  label: string
  icon: LucideIcon
  tint: string
  bar: string
}[] = [
  { status: 'queued', label: 'Queued', icon: Clock, tint: 'text-faint', bar: 'bg-line-strong' },
  {
    status: 'sending',
    label: 'Calling',
    icon: PhoneOutgoing,
    tint: 'text-info-fg',
    bar: 'bg-band-low',
  },
  { status: 'sent', label: 'Sent', icon: Send, tint: 'text-info-fg', bar: 'bg-accent-hover' },
  {
    status: 'delivered',
    label: 'Delivered',
    icon: CircleCheck,
    tint: 'text-ok-fg',
    bar: 'bg-band-ack',
  },
  { status: 'failed', label: 'Failed', icon: CircleX, tint: 'text-err-fg', bar: 'bg-band-high' },
  {
    status: 'needs_review',
    label: 'Needs review',
    icon: TriangleAlert,
    tint: 'text-warn-fg',
    bar: 'bg-band-elevated',
  },
]

/**
 * The pipeline as a single proportional bar.
 *
 * A board of columns answers "which calls are where"; it does not answer "is
 * dispatch working". This does, in one line: what share of calls landed, what
 * share was acknowledged, and what is stuck — which is the question anyone
 * opening this screen mid-incident is actually asking.
 */
function DeliveryFunnel({
  byStatus,
  total,
  acked,
}: {
  byStatus: Map<DeliveryStatus, Delivery[]>
  total: number
  acked: number
}) {
  if (total === 0) return null

  const segments = BOARD_COLUMNS.map((column) => ({
    ...column,
    count: byStatus.get(column.status)?.length ?? 0,
  })).filter((segment) => segment.count > 0)

  const delivered = byStatus.get('delivered')?.length ?? 0
  const rate = (value: number) => `${Math.round((value / total) * 100)}%`

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-semibold tabular-nums text-ink">
          {rate(delivered)}
        </span>
        <span className="text-eyebrow text-faint uppercase">
          delivered
        </span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-lg font-semibold tabular-nums text-ink">
          {rate(acked)}
        </span>
        <span className="text-eyebrow text-faint uppercase">
          acknowledged
        </span>
      </span>

      <span className="flex min-w-[14rem] flex-1 flex-col gap-1">
        <span className="flex h-2.5 overflow-hidden rounded-full">
          {segments.map((segment) => (
            <span
              key={segment.status}
              title={`${segment.count} ${segment.label.toLowerCase()}`}
              className={cx('h-full transition-[flex-grow] duration-[300ms] ease-standard', segment.bar)}
              style={{ flexGrow: segment.count }}
            />
          ))}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-2xs tabular-nums text-faint">
          {segments.map((segment) => (
            <span key={segment.status} className="flex items-center gap-1">
              <span aria-hidden className={cx('size-1.5 rounded-full', segment.bar)} />
              {segment.count} {segment.label.toLowerCase()}
            </span>
          ))}
        </span>
      </span>
    </div>
  )
}

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
  const activeColumns = BOARD_COLUMNS.filter(
    (column) => (byStatus.get(column.status)?.length ?? 0) > 0,
  )
  const emptyColumns = BOARD_COLUMNS.filter(
    (column) => (byStatus.get(column.status)?.length ?? 0) === 0,
  )
  const pendingAlerts = alertsQuery.data ?? []
  const canApprove = signer.trim().length > 1

  // One alert at a time: approving a voice call that will ring real phones
  // deserves undivided attention, not a scrollable stack.
  const [current, ...queued] = pendingAlerts
  const recipients = recipientsQuery.data ?? []
  const recipientsForCurrent = current?.zone_id
    ? recipients.filter((recipient) => recipient.zone_id === current.zone_id && recipient.active)
    : recipients.filter((recipient) => recipient.active)

  const recipientColumns: Column<Recipient>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (recipient) => <span className="font-medium text-ink">{recipient.name}</span>,
      sortBy: (recipient) => recipient.name,
    },
    {
      key: 'zone',
      header: 'Zone',
      render: (recipient) => (
        <span className="text-faint">{recipient.zone_name ?? recipient.zone_id}</span>
      ),
      sortBy: (recipient) => recipient.zone_name ?? recipient.zone_id,
    },
    {
      key: 'phone',
      header: 'Phone',
      width: '9rem',
      render: (recipient) => (
        <span className="font-mono text-2xs text-muted">{recipient.phone_e164}</span>
      ),
    },
    {
      key: 'language',
      header: 'Lang',
      width: '4rem',
      render: (recipient) => (
        <span className="font-mono text-2xs text-muted">
          {recipient.language.toUpperCase()}
        </span>
      ),
      sortBy: (recipient) => recipient.language,
    },
  ]

  return (
    <Screen width="wide">
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

        <DeliveryFunnel byStatus={byStatus} total={deliveries.length} acked={acked} />

        {/*
          Only statuses that actually hold something get a column.

          Six fixed columns meant that at any realistic volume four or five of
          them were a heading over the word "None" — a board that looked like
          the system had failed rather than like most calls had landed. The
          empty ones are summarised in one line underneath instead.
        */}
        <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {activeColumns.map((column) => {
            const items = byStatus.get(column.status) ?? []
            const Icon = column.icon
            return (
              <section key={column.status} className="min-w-0 bg-surface p-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-eyebrow text-faint uppercase">
                  <Icon size={13} strokeWidth={1.75} aria-hidden className={column.tint} />
                  {column.label}
                  <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-ink">
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
                  {items.length > 12 ? (
                    <li className="py-1 font-mono text-2xs text-faint">
                      +{items.length - 12} more
                    </li>
                  ) : null}
                </ul>
              </section>
            )
          })}
        </div>

        {emptyColumns.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface-2 px-3 py-2 text-2xs text-faint">
            <span className="text-eyebrow font-semibold uppercase">
              Empty
            </span>
            {emptyColumns.map((column) => (
              <span key={column.status} className="flex items-center gap-1">
                <column.icon size={11} strokeWidth={1.75} aria-hidden />
                {column.label}
              </span>
            ))}
          </p>
        ) : null}

        {deliveries.length === 0 && !deliveriesQuery.isLoading ? (
          <EmptyState icon={PhoneOutgoing} title="No calls yet">
            Approve an alert above and every recipient is queued in the same transaction.
          </EmptyState>
        ) : null}
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
            <h3 className="mb-2 text-eyebrow text-faint uppercase">
              Recipient roster
            </h3>
            {recipientsQuery.isError ? <ErrorNote error={recipientsQuery.error} /> : null}
            {/* Was a hand-rolled table with four unsized columns stretched
                across the card. DataTable gives it widths and sorting. */}
            <div className="max-h-80 overflow-y-auto">
              <DataTable
                columns={recipientColumns}
                rows={recipients}
                getRowId={(recipient) => recipient.id}
                loading={recipientsQuery.isLoading}
                caption="Alert recipients"
                empty={<EmptyState>No recipients registered.</EmptyState>}
              />
            </div>
          </div>
        </div>
      </Card>
    </Screen>
  )
}
