import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PhoneOutgoing } from 'lucide-react'
import { queryKeys, retryDelivery } from '../../lib/api'
import { fmtDateTime, maskPhone, titleCase } from '../../lib/format'
import {
  Button,
  EmptyState,
  ErrorNote,
  InfoHint,
  StatusChip,
  Tabs,
} from '../../components/ui'
import { cx } from '../../lib/cx'
import { useJustUpdated } from '../../stores/live'
import type { Delivery, DeliveryStatus } from '../../lib/types'
import { BOARD_COLUMNS, CHANNEL_ICON, CHANNEL_LABEL } from './constants'

/**
 * A delivery row that flashes once when SSE reports it changed — so a call
 * moving from queued to delivered while you are looking at the board is
 * visible, without anything blinking permanently.
 */
function DeliveryCard({ delivery, children }: { delivery: Delivery; children: ReactNode }) {
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

/** What one keypad press means, folded into a hint rather than its own card. */
function AckLegend() {
  return (
    <InfoHint
      content={
        <span className="block">
          <span className="mb-1 block font-medium">How recipients answer</span>
          <span className="block">1 — acknowledged, message heard and understood</span>
          <span className="block">2 — conflict reported, it is already active there</span>
          <span className="block">3 — resolved, the local situation has calmed</span>
          <span className="mt-1 block text-faint">
            Acknowledgements arrive by provider webhook and are idempotent — a repeated
            callback never double-counts.
          </span>
        </span>
      }
    />
  )
}

type Scope = 'focus' | 'all'

/**
 * Remount this with `key={focusAlertId}` rather than syncing scope in an
 * effect: a new approval should always land you on the calls you just queued.
 */
export function DeliveryBoard({
  deliveries,
  isLoading,
  error,
  focusAlertId,
  focusLabel,
}: {
  deliveries: Delivery[]
  isLoading: boolean
  error: unknown
  /** The alert whose deliveries to show first — normally the one just approved. */
  focusAlertId: string | null
  focusLabel?: string
}) {
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<Scope>(focusAlertId ? 'focus' : 'all')

  const retryMutation = useMutation({
    mutationFn: (deliveryId: string) => retryDelivery(deliveryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries })
    },
  })

  const focusCount = useMemo(
    () =>
      focusAlertId
        ? deliveries.filter((delivery) => delivery.alert_id === focusAlertId).length
        : 0,
    [deliveries, focusAlertId],
  )

  const visible = useMemo(() => {
    if (scope === 'all' || !focusAlertId) return deliveries
    return deliveries.filter((delivery) => delivery.alert_id === focusAlertId)
  }, [deliveries, focusAlertId, scope])

  const byStatus = useMemo(() => {
    const groups = new Map<DeliveryStatus, Delivery[]>()
    for (const column of BOARD_COLUMNS) groups.set(column.status, [])
    for (const delivery of visible) groups.get(delivery.status)?.push(delivery)
    return groups
  }, [visible])

  const activeColumns = BOARD_COLUMNS.filter(
    (column) => (byStatus.get(column.status)?.length ?? 0) > 0,
  )
  const emptyColumns = BOARD_COLUMNS.filter(
    (column) => (byStatus.get(column.status)?.length ?? 0) === 0,
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          Delivery board
          <AckLegend />
        </h2>
        {focusAlertId && focusCount > 0 ? (
          <Tabs
            size="sm"
            layoutId="delivery-scope"
            ariaLabel="Which deliveries to show"
            value={scope}
            onChange={setScope}
            items={[
              { id: 'focus' as const, label: focusLabel ?? 'Just sent', count: focusCount },
              { id: 'all' as const, label: 'All', count: deliveries.length },
            ]}
          />
        ) : null}
      </div>

      <p className="px-4 pb-3 text-2xs text-faint">
        Claim, place the call outside any transaction, then record the result. Stuck calls
        become needs-review — never a silent retry.
      </p>

      {error ? <ErrorNote error={error} className="m-4" /> : null}
      {retryMutation.isError ? <ErrorNote error={retryMutation.error} className="m-4" /> : null}

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
                {items.slice(0, 12).map((delivery) => {
                  const ChannelIcon = CHANNEL_ICON[delivery.channel]
                  return (
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
                        <span className="flex items-center gap-1">
                          <ChannelIcon size={11} strokeWidth={1.75} aria-hidden />
                          {CHANNEL_LABEL[delivery.channel]}
                        </span>
                        {delivery.zone_name ? <span>· {delivery.zone_name}</span> : null}
                        <span className="tabular-nums" title={delivery.phone_e164 ?? undefined}>
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
                            retryMutation.isPending && retryMutation.variables === delivery.id
                          }
                          onClick={() => retryMutation.mutate(delivery.id)}
                        >
                          Retry
                        </Button>
                      ) : null}
                    </DeliveryCard>
                  )
                })}
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

      {activeColumns.length > 0 && emptyColumns.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface-2 px-3 py-2 text-2xs text-faint">
          <span className="text-eyebrow font-semibold uppercase">Empty</span>
          {emptyColumns.map((column) => (
            <span key={column.status} className="flex items-center gap-1">
              <column.icon size={11} strokeWidth={1.75} aria-hidden />
              {column.label}
            </span>
          ))}
        </p>
      ) : null}

      {visible.length === 0 && !isLoading ? (
        <EmptyState icon={PhoneOutgoing} title="No calls yet">
          Approve an alert and every recipient you selected is queued in the same
          transaction.
        </EmptyState>
      ) : null}
    </>
  )
}
