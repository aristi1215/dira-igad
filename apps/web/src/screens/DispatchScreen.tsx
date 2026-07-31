import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  Inbox,
  Languages,
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
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import {
  approveAlert,
  createAlertVariant,
  createRecipient,
  deleteAlertVariant,
  deleteRecipient,
  fetchAlertRecipients,
  fetchAlertVariants,
  fetchDeliveries,
  fetchPendingAlerts,
  fetchRecipients,
  fetchZones,
  queryKeys,
  rejectAlert,
  retryDelivery,
  updateAlert,
  updateAlertVariant,
  updateRecipient,
} from '../lib/api'
import { BAND_MAP_COLORS, fmtDateTime, maskPhone, titleCase } from '../lib/format'
import {
  Button,
  Callout,
  Card,
  DataTable,
  DateStamp,
  EmptyState,
  ErrorNote,
  Field,
  ForecastWindow,
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
import type {
  Alert,
  AlertVariant,
  Delivery,
  DeliveryStatus,
  Recipient,
} from '../lib/types'

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/
/** The alert languages this room offers, in one place rather than four. */
const LANGUAGES = [
  { code: 'sw', label: 'Swahili (sw)' },
  { code: 'en', label: 'English (en)' },
  { code: 'am', label: 'Amharic (am)' },
  { code: 'so', label: 'Somali (so)' },
  { code: 'ar', label: 'Arabic (ar)' },
]
const VARIANT_SOURCE_LABEL: Record<AlertVariant['source'], string> = {
  llm: 'Drafted by AI',
  human_edited: 'Edited by you',
  human_authored: 'Written by you',
}
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

const SIGNER_STORAGE_KEY = 'dira.dispatch.signer'

/**
 * The approver's name, remembered between visits.
 *
 * It was retyped from scratch on every single approval, which is friction on
 * the one action nobody should be rushing. Remembering it does not weaken the
 * gate — the name is still written to `alerts.approved_by` with a timestamp on
 * every approval, and "not you?" clears it.
 */
function useStoredSigner(): [string, (value: string) => void] {
  const [signer, setSignerState] = useState(() => {
    try {
      return window.localStorage.getItem(SIGNER_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })

  const setSigner = (value: string) => {
    setSignerState(value)
    try {
      if (value.trim()) window.localStorage.setItem(SIGNER_STORAGE_KEY, value)
      else window.localStorage.removeItem(SIGNER_STORAGE_KEY)
    } catch {
      // Private-browsing quota errors must not block an approval.
    }
  }

  return [signer, setSigner]
}

/** A row in the selection list: a default target, or one the operator added. */
type TargetRow = {
  id: string
  name: string
  phone_e164: string
  channel: Recipient['channel']
  language: string
  zone_name: string | null
  reason: string
  /** True when no wording exists in their language and they get the default. */
  isFallback: boolean
}

function deliveriesFor(rows: TargetRow[]): { voice: number; sms: number } {
  let voice = 0
  let sms = 0
  for (const row of rows) {
    if (row.channel === 'voice' || row.channel === 'both') voice += 1
    if (row.channel === 'sms' || row.channel === 'both') sms += 1
  }
  return { voice, sms }
}

/**
 * The one place the Twilio SMS limitation is stated.
 *
 * It used to be pasted verbatim in three places on this screen, which is three
 * places to update and two chances to disagree with itself. It belongs beside
 * the channel controls, where it is actionable.
 */
function SmsCaveat({ className }: { className?: string }) {
  return (
    <Callout tone="info" className={className}>
      SMS delivery depends on the Twilio account: trial accounts block custom-body SMS.
      In this build SMS works end-to-end in seeded/mock mode; voice is the verified live
      channel.
    </Callout>
  )
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
  const [signer, setSigner] = useStoredSigner()
  const [editingAlert, setEditingAlert] = useState(false)
  const [alertBody, setAlertBody] = useState('')
  const [alertLanguage, setAlertLanguage] = useState('sw')
  const [recipientEditor, setRecipientEditor] = useState<{
    mode: 'create' | 'edit'
    recipient?: Recipient
  } | null>(null)
  const [recipientForm, setRecipientForm] = useState<RecipientForm>(EMPTY_RECIPIENT_FORM)
  // Keyed by alert id so the selection resets itself when the queue advances,
  // without an effect that could leave one alert's choices applied to the next.
  const [selection, setSelection] = useState<{ alertId: string; ids: string[] } | null>(
    null,
  )
  const [recipientFilter, setRecipientFilter] = useState('')
  // null = the alert's own body, which is always the last-resort wording.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [editingVariant, setEditingVariant] = useState(false)
  const [variantBody, setVariantBody] = useState('')
  const [showDraftDiff, setShowDraftDiff] = useState(false)
  const [addingLanguage, setAddingLanguage] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

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
  const pendingAlertId = (alertsQuery.data ?? [])[0]?.id
  const alertRecipientsQuery = useQuery({
    queryKey: queryKeys.alertRecipients(pendingAlertId ?? 'none'),
    queryFn: () => fetchAlertRecipients(pendingAlertId as string),
    enabled: Boolean(pendingAlertId),
  })
  const variantsQuery = useQuery({
    queryKey: queryKeys.alertVariants(pendingAlertId ?? 'none'),
    queryFn: () => fetchAlertVariants(pendingAlertId as string),
    enabled: Boolean(pendingAlertId),
  })

  const approveMutation = useMutation({
    mutationFn: (input: { alertId: string; recipientIds: string[] }) =>
      approveAlert(input.alertId, signer.trim(), input.recipientIds),
    onSuccess: (response) => {
      queryClient.setQueryData<Alert[]>(queryKeys.pendingAlerts, (current = []) =>
        current.filter((alert) => alert.id !== response.id),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries })
      void queryClient.invalidateQueries({ queryKey: queryKeys.allAlerts })
      setSelection(null)
      setConfirming(false)
    },
  })
  const rejectMutation = useMutation({
    mutationFn: (input: { alertId: string; reason: string }) =>
      rejectAlert(input.alertId, signer.trim(), input.reason),
    onSuccess: (response) => {
      queryClient.setQueryData<Alert[]>(queryKeys.pendingAlerts, (current = []) =>
        current.filter((alert) => alert.id !== response.id),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.allAlerts })
      setSelection(null)
      setRejecting(false)
      setRejectReason('')
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

  // Variant writes always refresh the recipient list too: adding a Somali
  // wording changes which recipients are still falling through to the default,
  // and that flag is what tells the operator the work is finished.
  const invalidateAlert = (alertId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.alertVariants(alertId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.alertRecipients(alertId) })
  }
  const draftVariantMutation = useMutation({
    mutationFn: (input: { alertId: string; language: string }) =>
      createAlertVariant(input.alertId, { language: input.language }),
    onSuccess: (variant) => {
      invalidateAlert(variant.alert_id)
      setActiveVariantId(variant.id)
    },
  })
  const editVariantMutation = useMutation({
    mutationFn: (input: { variantId: string; body_text: string }) =>
      updateAlertVariant(input.variantId, input.body_text),
    onSuccess: (variant) => {
      invalidateAlert(variant.alert_id)
      setEditingVariant(false)
    },
  })
  const deleteVariantMutation = useMutation({
    mutationFn: (input: { variantId: string; alertId: string }) =>
      deleteAlertVariant(input.variantId),
    onSuccess: (_result, input) => {
      invalidateAlert(input.alertId)
      setActiveVariantId(null)
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
  const zones = zonesQuery.data ?? []

  // The zone-matching rule lives on the server. This screen used to keep its
  // own copy in TypeScript, so the set an operator saw and the set that got
  // called could drift apart — and only the server's copy was real.
  const defaultTargets = alertRecipientsQuery.data ?? []
  const defaultIds = defaultTargets.map((target) => target.id)
  const selectedIds =
    selection && current && selection.alertId === current.id
      ? selection.ids
      : defaultIds
  const selectedSet = new Set(selectedIds)

  const defaultRows: TargetRow[] = defaultTargets.map((target) => ({
    id: target.id,
    name: target.name,
    phone_e164: target.phone_e164,
    channel: target.channel,
    language: target.language,
    zone_name: target.zone_name,
    reason: target.match_reason,
    isFallback: target.variant_is_fallback,
  }))
  const addedRows: TargetRow[] = recipients
    .filter(
      (recipient) =>
        selectedSet.has(recipient.id) &&
        !defaultTargets.some((target) => target.id === recipient.id),
    )
    .map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      phone_e164: recipient.phone_e164,
      channel: recipient.channel,
      language: recipient.language,
      zone_name: recipient.zone_name ?? null,
      reason: 'added by you',
      // Resolved server-side only for the default set; assume covered rather
      // than cry wolf about someone the operator deliberately added.
      isFallback: false,
    }))
  const targetRows = [...defaultRows, ...addedRows]
  const visibleRows = recipientFilter.trim()
    ? targetRows.filter((row) =>
        `${row.name} ${row.phone_e164} ${row.zone_name ?? ''} ${row.language}`
          .toLowerCase()
          .includes(recipientFilter.trim().toLowerCase()),
      )
    : targetRows

  const variants = variantsQuery.data ?? []
  const activeVariant = variants.find((variant) => variant.id === activeVariantId) ?? null
  const missingLanguages = LANGUAGES.filter(
    (language) =>
      language.code !== current?.language &&
      !variants.some((variant) => variant.language === language.code),
  )
  const fallbackCount = defaultTargets.filter((target) => target.variant_is_fallback).length

  const selectedRows = targetRows.filter((row) => selectedSet.has(row.id))
  const channelMix = deliveriesFor(selectedRows)
  const expectedDeliveryCount = channelMix.voice + channelMix.sms

  const setSelectedIds = (ids: string[]) => {
    if (!current) return
    setSelection({ alertId: current.id, ids })
  }
  const toggleRecipient = (id: string) => {
    setSelectedIds(
      selectedSet.has(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id],
    )
  }

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
              {/*
                What the alert is about, when it was drafted, and — at display
                size — the period it warns about. The window used to be a
                `text-xs` line of raw ISO dates below the message body, which
                is the wrong weight for the single fact an approver is being
                asked to stand behind.
              */}
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusChip tone="warning">Pending approval</StatusChip>
                  <span className="text-sm font-semibold text-ink">
                    {current.zone_name ?? 'Voice alert'}
                  </span>
                  <span className="text-2xs text-faint">
                    {current.language.toUpperCase()} message
                  </span>
                  <DateStamp title="When this alert was drafted">
                    Drafted {fmtDateTime(current.created_at)}
                  </DateStamp>
                </div>
                <ForecastWindow
                  label="Warns about"
                  start={current.window_start}
                  end={current.window_end}
                  className="shrink-0"
                />
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
                      {LANGUAGES.map((language) => (
                        <option key={language.code} value={language.code}>
                          {language.label}
                        </option>
                      ))}
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
                  {/*
                    One alert, several wordings. `recipients.language` used to
                    be collected and read by nothing — a contact registered as
                    Somali received the Swahili text. These tabs are where that
                    stops being invisible.
                  */}
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveVariantId(null)
                        setEditingVariant(false)
                      }}
                      className={cx(
                        'rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
                        activeVariantId === null
                          ? 'border-accent bg-accent-soft text-ink'
                          : 'border-line text-muted hover:text-ink',
                      )}
                    >
                      {current.language.toUpperCase()} · default
                    </button>
                    {variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => {
                          setActiveVariantId(variant.id)
                          setEditingVariant(false)
                          setShowDraftDiff(false)
                        }}
                        className={cx(
                          'rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
                          activeVariantId === variant.id
                            ? 'border-accent bg-accent-soft text-ink'
                            : 'border-line text-muted hover:text-ink',
                        )}
                      >
                        {variant.language.toUpperCase()}
                        {variant.role ? ` · ${titleCase(variant.role)}` : ''}
                      </button>
                    ))}
                    {current.status === 'pending_approval' && missingLanguages.length > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Languages}
                        loading={draftVariantMutation.isPending}
                        onClick={() => setAddingLanguage(true)}
                      >
                        Add language
                      </Button>
                    ) : null}
                  </div>

                  {draftVariantMutation.isError ? (
                    <ErrorNote error={draftVariantMutation.error} className="mb-2" />
                  ) : null}

                  {editingVariant && activeVariant ? (
                    <form
                      className="grid gap-3 rounded-md border border-line bg-surface-2 p-3"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault()
                        editVariantMutation.mutate({
                          variantId: activeVariant.id,
                          body_text: variantBody,
                        })
                      }}
                    >
                      <Field
                        label={`${activeVariant.language.toUpperCase()} message`}
                        htmlFor="variant-body"
                      >
                        <textarea
                          id="variant-body"
                          value={variantBody}
                          maxLength={4000}
                          rows={4}
                          onChange={(event) => setVariantBody(event.target.value)}
                          className="w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent-ring/40"
                        />
                      </Field>
                      {editVariantMutation.isError ? (
                        <ErrorNote error={editVariantMutation.error} />
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          variant="primary"
                          icon={Save}
                          loading={editVariantMutation.isPending}
                        >
                          Save wording
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingVariant(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      {/* The alert body is the product. It gets to be the biggest thing here. */}
                      <blockquote className="rounded-md border border-line border-l-[3px] border-l-accent bg-surface-2 px-4 py-3 text-md leading-relaxed text-ink">
                        {activeVariant ? activeVariant.body_text : current.body_text}
                      </blockquote>

                      {activeVariant?.llm_draft &&
                      activeVariant.llm_draft !== activeVariant.body_text &&
                      showDraftDiff ? (
                        <blockquote className="mt-1.5 rounded-md border border-dashed border-line bg-surface px-4 py-2.5 text-xs leading-relaxed text-faint">
                          <span className="mb-1 block text-eyebrow uppercase">
                            AI draft, before your edit
                          </span>
                          {activeVariant.llm_draft}
                        </blockquote>
                      ) : null}

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                        <p className="flex flex-wrap items-center gap-2 text-xs text-faint">
                          Read it as the recipient will hear it.
                          {activeVariant ? (
                            <StatusChip
                              tone={
                                activeVariant.source === 'llm' ? 'neutral' : 'success'
                              }
                            >
                              {VARIANT_SOURCE_LABEL[activeVariant.source]}
                            </StatusChip>
                          ) : null}
                        </p>
                        {current.status === 'pending_approval' ? (
                          <span className="flex flex-wrap items-center gap-1">
                            {activeVariant?.llm_draft &&
                            activeVariant.llm_draft !== activeVariant.body_text ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowDraftDiff((shown) => !shown)}
                              >
                                {showDraftDiff ? 'Hide AI draft' : 'Show AI draft'}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Pencil}
                              onClick={() => {
                                if (activeVariant) {
                                  setVariantBody(activeVariant.body_text)
                                  setEditingVariant(true)
                                } else {
                                  setAlertBody(current.body_text)
                                  setAlertLanguage(current.language)
                                  setEditingAlert(true)
                                }
                              }}
                            >
                              Edit message
                            </Button>
                            {activeVariant ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={Trash2}
                                loading={deleteVariantMutation.isPending}
                                onClick={() =>
                                  deleteVariantMutation.mutate({
                                    variantId: activeVariant.id,
                                    alertId: current.id,
                                  })
                                }
                              >
                                Remove
                              </Button>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Who this reaches
                  </h3>
                  <span className="text-xs tabular-nums text-muted">
                    {selectedRows.length} of {targetRows.length} selected ·{' '}
                    {expectedDeliveryCount} deliver
                    {expectedDeliveryCount === 1 ? 'y' : 'ies'}
                    {channelMix.voice && channelMix.sms
                      ? ` (${channelMix.voice} voice, ${channelMix.sms} SMS)`
                      : ''}
                  </span>
                </div>

                {alertRecipientsQuery.isError ? (
                  <ErrorNote error={alertRecipientsQuery.error} className="mt-2" />
                ) : null}

                {/*
                  The whole point of variants is that this is visible. Without
                  it, a Somali speaker quietly receiving Swahili looks exactly
                  like a successful delivery.
                */}
                {fallbackCount > 0 ? (
                  <Callout tone="warning" className="mt-2">
                    {fallbackCount} recipient{fallbackCount === 1 ? '' : 's'} hear
                    {fallbackCount === 1 ? 's' : ''} the default{' '}
                    {current.language.toUpperCase()} message because nothing is written
                    in their language. Add a wording above, or send it knowingly.
                  </Callout>
                ) : null}

                {targetRows.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TextInput
                      value={recipientFilter}
                      placeholder="Filter by name, zone, number…"
                      aria-label="Filter recipients"
                      className="h-8 max-w-56 text-xs"
                      onChange={(event) => setRecipientFilter(event.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedIds(targetRows.map((row) => row.id))}
                      disabled={selectedRows.length === targetRows.length}
                    >
                      Select all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedIds([])}
                      disabled={selectedRows.length === 0}
                    >
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={UserPlus}
                      className="ml-auto"
                      onClick={() => setPicking(true)}
                    >
                      Add from roster
                    </Button>
                  </div>
                ) : null}

                {alertRecipientsQuery.isLoading ? (
                  <SkeletonText lines={2} className="mt-2" />
                ) : targetRows.length === 0 ? (
                  <p className="mt-1.5 text-sm text-warn-fg">
                    No active recipients match this zone. Add someone from the roster,
                    or reject the alert.
                  </p>
                ) : (
                  <ul className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {visibleRows.map((row) => {
                      const Icon = CHANNEL_ICON[row.channel]
                      const checked = selectedSet.has(row.id)
                      return (
                        <li key={row.id}>
                          <label
                            className={cx(
                              'flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-1.5 text-xs transition-colors',
                              checked
                                ? 'border-accent bg-surface'
                                : 'border-line bg-surface opacity-60',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRecipient(row.id)}
                              className="size-3.5 shrink-0 accent-[var(--color-accent)]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-ink">
                                {row.name}
                              </span>
                              <span className="block truncate text-2xs text-faint">
                                {row.zone_name ?? 'All zones'} · {row.reason} ·{' '}
                                <span className="tabular-nums">
                                  {maskPhone(row.phone_e164)}
                                </span>
                              </span>
                            </span>
                            <span
                              className={cx(
                                'flex shrink-0 items-center gap-1 text-2xs',
                                row.isFallback ? 'text-warn-fg' : 'text-muted',
                              )}
                              title={
                                row.isFallback
                                  ? `No ${row.language.toUpperCase()} wording — hears the default message`
                                  : undefined
                              }
                            >
                              <Icon size={13} strokeWidth={1.75} aria-hidden />
                              {row.language.toUpperCase()}
                              {row.isFallback ? '*' : ''}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                    {visibleRows.length === 0 ? (
                      <li className="py-1 text-2xs text-faint">
                        No recipient matches “{recipientFilter}”.
                      </li>
                    ) : null}
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
                  disabled={!canApprove || selectedRows.length === 0}
                  title={
                    !canApprove
                      ? 'Enter your name first'
                      : selectedRows.length === 0
                        ? 'Select at least one recipient'
                        : undefined
                  }
                  onClick={() => setConfirming(true)}
                  className="mb-0.5"
                >
                  {/* "calls" was wrong for an SMS-only send. */}
                  Approve & queue {expectedDeliveryCount} deliver
                  {expectedDeliveryCount === 1 ? 'y' : 'ies'}
                </Button>
                <Button
                  variant="ghost"
                  icon={Ban}
                  disabled={!canApprove}
                  title={canApprove ? undefined : 'Enter your name first'}
                  onClick={() => setRejecting(true)}
                  className="mb-0.5"
                >
                  Reject
                </Button>
                <p className="mb-2 flex items-center gap-1.5 text-2xs text-faint">
                  <Lock size={11} strokeWidth={1.75} aria-hidden />
                  Either way, recorded with your name and a timestamp
                </p>
                {signer.trim() ? (
                  <button
                    type="button"
                    className="mb-2 text-2xs text-faint underline underline-offset-2 hover:text-ink"
                    onClick={() => setSigner('')}
                  >
                    Not {signer.trim()}?
                  </button>
                ) : null}
              </div>
              <SmsCaveat className="mt-3" />
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
                      {/*
                        Who the call was to comes first. This card used to lead
                        with the channel — "Voice · 2 attempts" — which told an
                        operator nothing about which contact had failed.
                      */}
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-2xs font-medium text-ink">
                          {delivery.recipient_name ?? 'Unknown recipient'}
                        </span>
                        {delivery.ack_status !== 'none' ? (
                          <StatusChip tone="success" className="ml-auto shrink-0">
                            {titleCase(delivery.ack_status)}
                          </StatusChip>
                        ) : null}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-faint">
                        {(() => {
                          const ChannelIcon = CHANNEL_ICON[delivery.channel]
                          return (
                            <span className="flex items-center gap-1">
                              <ChannelIcon size={11} strokeWidth={1.75} aria-hidden />
                              {CHANNEL_LABEL[delivery.channel]}
                            </span>
                          )
                        })()}
                        {delivery.zone_name ? <span>· {delivery.zone_name}</span> : null}
                        <span
                          className="tabular-nums"
                          title={delivery.phone_e164 ?? undefined}
                        >
                          · {maskPhone(delivery.phone_e164)}
                        </span>
                      </p>
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
                          // Scoped to this row: the shared mutation flag spun
                          // every needs-review button on the board at once.
                          loading={
                            retryMutation.isPending &&
                            retryMutation.variables === delivery.id
                          }
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

      {/*
        The roster used to live inside a card titled "Reference", beside a
        keypad legend. It is the operational half of this screen — the set of
        people the gate above dispatches to — and gets its own card.
      */}
      <Card
        title="Recipient roster"
        subtitle="Everyone this room can reach. Deactivating keeps delivery history."
        className="mb-5"
        actions={
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
        }
      >
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
      </Card>

      <Card title="How recipients answer" subtitle="One keypad press, landed by webhook">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-start">
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
          <Callout tone="info">
            Acknowledgements arrive by provider webhook and are idempotent — a repeated
            callback never double-counts.
          </Callout>
        </div>
      </Card>

      {addingLanguage && current ? (
        <Modal
          title="Add a wording"
          eyebrow="Alert languages"
          onClose={() => setAddingLanguage(false)}
        >
          <p className="mb-3 text-sm text-muted">
            The advisor drafts this alert again in the chosen language. You can edit it
            afterwards — the original draft is kept either way.
          </p>
          <ul className="grid gap-1.5">
            {missingLanguages.map((language) => (
              <li key={language.code}>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  loading={
                    draftVariantMutation.isPending &&
                    draftVariantMutation.variables?.language === language.code
                  }
                  onClick={() => {
                    draftVariantMutation.mutate({
                      alertId: current.id,
                      language: language.code,
                    })
                    setAddingLanguage(false)
                  }}
                >
                  {language.label}
                </Button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {confirming && current ? (
        <Modal
          title="Send this alert?"
          eyebrow="Confirm dispatch"
          onClose={() => setConfirming(false)}
        >
          {/*
            The one deliberate beat before real phones ring. It restates what is
            about to happen in the operator's own terms — not a generic "are you
            sure", which teaches people to click through.
          */}
          <div className="grid gap-3">
            <StatRow>
              <Stat label="Recipients" value={selectedRows.length} />
              <Stat label="Voice calls" value={channelMix.voice} />
              <Stat label="SMS" value={channelMix.sms} />
            </StatRow>
            <blockquote className="rounded-md border border-line border-l-[3px] border-l-accent bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink">
              {current.body_text}
            </blockquote>
            <p className="text-xs text-faint">
              Approving as <span className="font-medium text-ink">{signer.trim()}</span>{' '}
              in {current.language.toUpperCase()}. This cannot be undone — queued
              deliveries start dispatching immediately.
            </p>
            {approveMutation.isError ? <ErrorNote error={approveMutation.error} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={PhoneOutgoing}
                loading={approveMutation.isPending}
                onClick={() =>
                  approveMutation.mutate({
                    alertId: current.id,
                    recipientIds: selectedIds,
                  })
                }
              >
                {approveMutation.isPending ? 'Approving…' : 'Yes, send it'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {rejecting && current ? (
        <Modal
          title="Reject this alert"
          eyebrow="Human gate"
          onClose={() => setRejecting(false)}
        >
          <form
            className="grid gap-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              rejectMutation.mutate({ alertId: current.id, reason: rejectReason.trim() })
            }}
          >
            <p className="text-sm text-muted">
              Nothing is queued and nothing is sent. The alert is closed on the record
              under your name, so a decision not to warn is as auditable as a decision
              to warn.
            </p>
            <Field label="Why?" htmlFor="reject-reason" hint="Optional, but it is what the next reader sees.">
              <textarea
                id="reject-reason"
                rows={3}
                maxLength={2000}
                value={rejectReason}
                placeholder="Duplicate of this morning's alert…"
                onChange={(event) => setRejectReason(event.target.value)}
                className="w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent-ring/40"
              />
            </Field>
            {rejectMutation.isError ? <ErrorNote error={rejectMutation.error} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" icon={Ban} loading={rejectMutation.isPending}>
                Reject alert
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {picking && current ? (
        <Modal
          title="Add from roster"
          eyebrow="Recipients for this alert"
          onClose={() => setPicking(false)}
        >
          <p className="mb-3 text-sm text-muted">
            Anyone active can be added, including contacts outside this alert's zone —
            a neighbouring chief often needs the same warning.
          </p>
          <ul className="grid max-h-80 gap-1.5 overflow-y-auto">
            {recipients
              .filter((recipient) => recipient.active)
              .map((recipient) => {
                const checked = selectedSet.has(recipient.id)
                const isDefault = defaultTargets.some(
                  (target) => target.id === recipient.id,
                )
                return (
                  <li key={recipient.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRecipient(recipient.id)}
                        className="size-3.5 shrink-0 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {recipient.name}
                        </span>
                        <span className="block truncate text-2xs text-faint">
                          {recipient.zone_name ?? 'All zones'}
                          {isDefault ? ' · already targeted' : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-2xs text-muted">
                        {CHANNEL_LABEL[recipient.channel]}
                      </span>
                    </label>
                  </li>
                )
              })}
          </ul>
          <div className="mt-3">
            <Button variant="primary" onClick={() => setPicking(false)}>
              Done
            </Button>
          </div>
        </Modal>
      ) : null}

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
                  {LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
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
            <SmsCaveat />
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
