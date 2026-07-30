import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleCheck,
  CircleX,
  Clock,
  Inbox,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Radio,
  Save,
  Trash2,
  PhoneOutgoing,
  Send,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import {
  approveAlert,
  createRecipient,
  deleteRecipient,
  fetchDeliveries,
  fetchPendingAlerts,
  fetchRecipients,
  fetchZones,
  queryKeys,
  retryDelivery,
  updateAlert,
  updateRecipient,
} from '../lib/api'
import { BAND_MAP_COLORS, fmtDateTime, titleCase } from '../lib/format'
import {
  Button,
  Callout,
  Card,
  DataTable,
  DateStamp,
  EmptyState,
  ErrorNote,
  Field,
  Kbd,
  PageHeader,
  Screen,
  Select,
  SkeletonText,
  Stat,
  StatRow,
  StatusChip,
  TextInput,
  type Column,
} from '../components/ui'
import { Modal } from '../components/Modal'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'
import { useJustUpdated } from '../stores/live'
import { cx } from '../lib/cx'
import type { Alert, Delivery, DeliveryStatus, Recipient } from '../lib/types'

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/
const CHANNEL_LABEL: Record<Recipient['channel'], string> = {
  voice: 'Voice',
  sms: 'SMS',
  both: 'Voice + SMS',
}
const CHANNEL_ICON: Record<Recipient['channel'], LucideIcon> = {
  voice: PhoneOutgoing,
  sms: MessageSquare,
  both: Radio,
}

type RecipientForm = {
  name: string
  phone_e164: string
  zone_id: string
  language: string
  channel: Recipient['channel']
  active: boolean
}

const EMPTY_RECIPIENT_FORM: RecipientForm = {
  name: '',
  phone_e164: '',
  zone_id: '',
  language: 'sw',
  channel: 'voice',
  active: true,
}

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
        <span className="text-lg font-semibold tabular-nums text-ink">
          {rate(delivered)}
        </span>
        <span className="text-eyebrow text-faint uppercase">
          delivered
        </span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums text-ink">
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
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs tabular-nums text-faint">
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
  const [editingAlert, setEditingAlert] = useState(false)
  const [alertBody, setAlertBody] = useState('')
  const [alertLanguage, setAlertLanguage] = useState('sw')
  const [recipientEditor, setRecipientEditor] = useState<{
    mode: 'create' | 'edit'
    recipient?: Recipient
  } | null>(null)
  const [recipientForm, setRecipientForm] = useState<RecipientForm>(EMPTY_RECIPIENT_FORM)

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
  const zonesQuery = useQuery({
    queryKey: queryKeys.zones,
    queryFn: fetchZones,
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
  const editAlertMutation = useMutation({
    mutationFn: (input: { alertId: string; body_text: string; language: string }) =>
      updateAlert(input.alertId, { body_text: input.body_text, language: input.language }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Alert[]>(queryKeys.pendingAlerts, (alerts = []) =>
        alerts.map((alert) => (alert.id === updated.id ? { ...alert, ...updated } : alert)),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingAlerts })
      setEditingAlert(false)
    },
  })
  const recipientMutation = useMutation({
    mutationFn: (input: { id?: string; form: RecipientForm }) =>
      input.id
        ? updateRecipient(input.id, {
            name: input.form.name,
            phone_e164: input.form.phone_e164,
            language: input.form.language,
            channel: input.form.channel,
            active: input.form.active,
          })
        : createRecipient({
            name: input.form.name,
            phone_e164: input.form.phone_e164,
            zone_id: input.form.zone_id || null,
            language: input.form.language,
            channel: input.form.channel,
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipients })
      setRecipientEditor(null)
    },
  })
  const deleteRecipientMutation = useMutation({
    mutationFn: deleteRecipient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipients })
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
    ? recipients.filter(
        (recipient) =>
          recipient.active &&
          (recipient.zone_id === current.zone_id || recipient.zone_id === null),
      )
    : recipients.filter((recipient) => recipient.active)
  const expectedDeliveryCount = recipientsForCurrent.reduce(
    (total, recipient) => total + (recipient.channel === 'both' ? 2 : 1),
    0,
  )
  const zones = zonesQuery.data ?? []

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
        <span className="text-faint">
          {recipient.zone_name ?? recipient.zone_id ?? 'All zones'}
        </span>
      ),
      sortBy: (recipient) => recipient.zone_name ?? recipient.zone_id ?? 'All zones',
    },
    {
      key: 'phone',
      header: 'Phone',
      width: '9rem',
      render: (recipient) => (
        <span className="tabular-nums text-2xs text-muted">{recipient.phone_e164}</span>
      ),
    },
    {
      key: 'language',
      header: 'Lang',
      width: '4rem',
      render: (recipient) => (
        <span className="tabular-nums text-2xs text-muted">
          {recipient.language.toUpperCase()}
        </span>
      ),
      sortBy: (recipient) => recipient.language,
    },
    {
      key: 'channel',
      header: 'Channel',
      width: '7rem',
      render: (recipient) => {
        const Icon = CHANNEL_ICON[recipient.channel]
        return (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Icon size={13} strokeWidth={1.75} aria-hidden />
            {CHANNEL_LABEL[recipient.channel]}
          </span>
        )
      },
      sortBy: (recipient) => recipient.channel,
    },
    {
      key: 'status',
      header: 'Status',
      width: '6rem',
      render: (recipient) => (
        <StatusChip tone={recipient.active ? 'success' : 'neutral'}>
          {recipient.active ? 'Active' : 'Inactive'}
        </StatusChip>
      ),
      sortBy: (recipient) => (recipient.active ? 1 : 0),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '7rem',
      render: (recipient) => (
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={Pencil}
            aria-label={`Edit ${recipient.name}`}
            title={`Edit ${recipient.name}`}
            onClick={() => {
              setRecipientForm({
                name: recipient.name,
                phone_e164: recipient.phone_e164,
                zone_id: recipient.zone_id ?? '',
                language: recipient.language,
                channel: recipient.channel,
                active: recipient.active,
              })
              setRecipientEditor({ mode: 'edit', recipient })
            }}
          >
            <span className="sr-only">Edit</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            aria-label={`Deactivate ${recipient.name}`}
            title={`Deactivate ${recipient.name}`}
            disabled={!recipient.active || deleteRecipientMutation.isPending}
            onClick={() => {
              if (window.confirm(`Deactivate ${recipient.name}? This keeps delivery history.`)) {
                deleteRecipientMutation.mutate(recipient.id)
              }
            }}
          >
            <span className="sr-only">Deactivate</span>
          </Button>
        </span>
      ),
    },
  ]

  return (
    <Screen width="wide">
      <PageHeader
        eyebrow="Dispatch console"
        title="Approve and send"
        description="This screen turns a drafted situation alert into voice calls or SMS only after a named human approves it. Nobody — including the AI advisor — can dispatch without that approval; once approved, the room queues every active recipient for the zone in one transaction."
      />

      {/*
        A lone "Human-gated delivery" tile used to sit here, outside any grid —
        so its span class did nothing — saying what the page description above
        and the human-gate card below both already say.
      */}
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
                  {current.language.toUpperCase()} message · drafted
                </span>
                <DateStamp>{fmtDateTime(current.created_at)}</DateStamp>
              </div>

              {editingAlert && current.status === 'pending_approval' ? (
                <form
                  className="grid gap-3 rounded-md border border-line bg-surface-2 p-3"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    editAlertMutation.mutate({
                      alertId: current.id,
                      body_text: alertBody,
                      language: alertLanguage,
                    })
                  }}
                >
                  <Field label="Alert message" htmlFor="alert-body">
                    <textarea
                      id="alert-body"
                      value={alertBody}
                      maxLength={4000}
                      rows={4}
                      onChange={(event) => setAlertBody(event.target.value)}
                      className="w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent-ring/40"
                    />
                    <span className={cx('text-2xs', alertBody.length > 320 ? 'text-warn-fg' : 'text-faint')}>
                      {alertBody.length}/4000 characters
                      {alertBody.length > 320 ? ' · Long for a voice-readable alert' : ''}
                    </span>
                  </Field>
                  <Field label="Language" htmlFor="alert-language">
                    <Select
                      id="alert-language"
                      value={alertLanguage}
                      onChange={(event) => setAlertLanguage(event.target.value)}
                    >
                      <option value="sw">Swahili (sw)</option>
                      <option value="en">English (en)</option>
                      <option value="am">Amharic (am)</option>
                      <option value="so">Somali (so)</option>
                      <option value="ar">Arabic (ar)</option>
                    </Select>
                  </Field>
                  {editAlertMutation.isError ? <ErrorNote error={editAlertMutation.error} /> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="primary" icon={Save} loading={editAlertMutation.isPending}>
                      Save message
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEditingAlert(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  {/* The alert body is the product. It gets to be the biggest thing here. */}
                  <blockquote className="rounded-md border border-line border-l-[3px] border-l-accent bg-surface-2 px-4 py-3 text-md leading-relaxed text-ink">
                    {current.body_text}
                  </blockquote>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-faint">
                      Read it as the recipient will hear it.
                    </p>
                    {current.status === 'pending_approval' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Pencil}
                        onClick={() => {
                          setAlertBody(current.body_text)
                          setAlertLanguage(current.language)
                          setEditingAlert(true)
                        }}
                      >
                        Edit message
                      </Button>
                    ) : null}
                  </div>
                </>
              )}

              {current.window_start && current.window_end ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <span>Forecast window:</span>
                  <DateStamp>{current.window_start}</DateStamp>
                  <span>–</span>
                  <DateStamp>{current.window_end}</DateStamp>
                </div>
              ) : null}

              <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">Recipients for this alert</h3>
                  <span className="text-xs tabular-nums text-muted">
                    {expectedDeliveryCount} deliveries expected
                  </span>
                </div>
                {recipientsForCurrent.length === 0 ? (
                  <p className="mt-1.5 text-sm text-warn-fg">
                    No matching active recipients. Approval will queue no delivery.
                  </p>
                ) : (
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {recipientsForCurrent.map((recipient) => {
                      const Icon = CHANNEL_ICON[recipient.channel]
                      return (
                        <li
                          key={recipient.id}
                          className="flex items-center justify-between gap-2 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs"
                        >
                          <span className="min-w-0 truncate font-medium text-ink">
                            {recipient.name}
                          </span>
                          <span className="flex shrink-0 items-center gap-1 text-muted">
                            <Icon size={13} strokeWidth={1.75} aria-hidden />
                            {CHANNEL_LABEL[recipient.channel]}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

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
              <p className="mt-2 text-2xs text-faint">
                SMS delivery depends on the Twilio account: trial accounts block custom-body SMS.
                In this build SMS works end-to-end in seeded/mock mode; voice is the verified live channel.
              </p>
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
                  <span className="ml-auto text-sm font-semibold tabular-nums text-ink">
                    {items.length}
                  </span>
                </h3>

                <ul className="flex flex-col gap-1.5">
                  {items.slice(0, 12).map((delivery) => (
                    <DeliveryCard key={delivery.id} delivery={delivery}>
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const ChannelIcon = CHANNEL_ICON[delivery.channel]
                          return (
                            <span className="flex items-center gap-1 text-2xs font-medium text-ink">
                              <ChannelIcon size={13} strokeWidth={1.75} aria-hidden />
                              {CHANNEL_LABEL[delivery.channel]}
                            </span>
                          )
                        })()}
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
                    <li className="py-1 tabular-nums text-2xs text-faint">
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-eyebrow text-faint uppercase">Recipient roster</h3>
              <Button
                size="sm"
                variant="secondary"
                icon={Plus}
                onClick={() => {
                  setRecipientForm(EMPTY_RECIPIENT_FORM)
                  setRecipientEditor({ mode: 'create' })
                }}
              >
                Add recipient
              </Button>
            </div>
            {recipientsQuery.isError ? <ErrorNote error={recipientsQuery.error} /> : null}
            {deleteRecipientMutation.isError ? (
              <ErrorNote error={deleteRecipientMutation.error} className="mb-2" />
            ) : null}
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
            <Callout tone="info" className="mt-3">
              SMS delivery depends on the Twilio account: trial accounts block custom-body SMS.
              In this build SMS works end-to-end in seeded/mock mode; voice is the verified live channel.
            </Callout>
          </div>
        </div>
      </Card>

      {recipientEditor ? (
        <Modal
          title={recipientEditor.mode === 'create' ? 'Add recipient' : 'Edit recipient'}
          eyebrow="Recipient roster"
          onClose={() => setRecipientEditor(null)}
        >
          <form
            className="grid gap-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              if (!PHONE_PATTERN.test(recipientForm.phone_e164)) return
              recipientMutation.mutate({
                id: recipientEditor.recipient?.id,
                form: recipientForm,
              })
            }}
          >
            <Field label="Name" htmlFor="recipient-name">
              <TextInput
                id="recipient-name"
                required
                value={recipientForm.name}
                onChange={(event) =>
                  setRecipientForm((form) => ({ ...form, name: event.target.value }))
                }
              />
            </Field>
            <Field
              label="Phone (E.164)"
              htmlFor="recipient-phone"
              hint="Format: +2547XXXXXXXX"
              error={
                recipientForm.phone_e164 && !PHONE_PATTERN.test(recipientForm.phone_e164)
                  ? 'Use an international number such as +2547XXXXXXXX.'
                  : undefined
              }
            >
              <TextInput
                id="recipient-phone"
                required
                value={recipientForm.phone_e164}
                placeholder="+2547XXXXXXXX"
                onChange={(event) =>
                  setRecipientForm((form) => ({ ...form, phone_e164: event.target.value }))
                }
              />
            </Field>
            <Field label="Zone" htmlFor="recipient-zone" hint="All zones sends to any zone alert.">
              <Select
                id="recipient-zone"
                value={recipientForm.zone_id}
                onChange={(event) =>
                  setRecipientForm((form) => ({ ...form, zone_id: event.target.value }))
                }
                disabled={recipientEditor.mode === 'edit'}
              >
                <option value="">All zones</option>
                {zones.map((zone) => (
                  <option key={zone.zone_id} value={zone.zone_id}>
                    {zone.zone_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Language" htmlFor="recipient-language">
                <Select
                  id="recipient-language"
                  value={recipientForm.language}
                  onChange={(event) =>
                    setRecipientForm((form) => ({ ...form, language: event.target.value }))
                  }
                >
                  <option value="sw">Swahili (sw)</option>
                  <option value="en">English (en)</option>
                  <option value="am">Amharic (am)</option>
                  <option value="so">Somali (so)</option>
                  <option value="ar">Arabic (ar)</option>
                </Select>
              </Field>
              <Field label="Channel" htmlFor="recipient-channel">
                <Select
                  id="recipient-channel"
                  value={recipientForm.channel}
                  onChange={(event) =>
                    setRecipientForm((form) => ({
                      ...form,
                      channel: event.target.value as Recipient['channel'],
                    }))
                  }
                >
                  <option value="voice">Voice call</option>
                  <option value="sms">SMS</option>
                  <option value="both">Voice + SMS</option>
                </Select>
              </Field>
            </div>
            {recipientEditor.mode === 'edit' ? (
              <Field label="Status" htmlFor="recipient-active">
                <Select
                  id="recipient-active"
                  value={recipientForm.active ? 'active' : 'inactive'}
                  onChange={(event) => {
                    const active = event.target.value === 'active'
                    setRecipientForm((form) => ({ ...form, active }))
                  }}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Field>
            ) : null}
            <p className="text-xs text-faint">
              SMS delivery depends on the Twilio account: trial accounts block custom-body SMS.
              In this build SMS works end-to-end in seeded/mock mode; voice is the verified live channel.
            </p>
            {recipientMutation.isError ? <ErrorNote error={recipientMutation.error} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                icon={Save}
                loading={recipientMutation.isPending}
                disabled={!recipientForm.name.trim() || !PHONE_PATTERN.test(recipientForm.phone_e164)}
              >
                {recipientEditor.mode === 'create' ? 'Add recipient' : 'Save recipient'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRecipientEditor(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Screen>
  )
}
