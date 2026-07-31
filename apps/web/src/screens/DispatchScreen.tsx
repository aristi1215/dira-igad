import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, Plus } from 'lucide-react'
import {
  fetchAlertRecipients,
  fetchAlertVariants,
  fetchDeliveries,
  fetchPendingAlerts,
  fetchRecipients,
  fetchZones,
  queryKeys,
} from '../lib/api'
import {
  BentoCard,
  BentoGrid,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Screen,
  SkeletonText,
} from '../components/ui'
import { TOUR_ANCHORS } from '../features/tour/tourAnchors'
import {
  AlertEditor,
  AlertQueue,
  BOARD_COLUMNS,
  ComposeAlertModal,
  DeliveryBoard,
  DeliveryFunnel,
  PeoplePanel,
  RecipientFormModal,
  SendPanel,
  useSelectedAlert,
  useStoredSigner,
  type RecipientEditorState,
  type TargetRow,
} from '../features/dispatch'
import type { Alert, Delivery, DeliveryStatus, Recipient } from '../lib/types'

/**
 * The dispatch console.
 *
 * Two nouns, side by side: the message, and the people who will hear it. The
 * screen used to stack four metric tiles, a page-tall approval card, the
 * delivery board and only then the roster — so "who does this reach" and "who
 * can I reach at all" were a thousand pixels apart, and starting an alert was
 * something you could only do from another screen.
 */
export function DispatchScreen() {
  const queryClient = useQueryClient()
  const [signer, setSigner] = useStoredSigner()
  const { requestedAlertId, selectAlert } = useSelectedAlert()

  // Keyed by alert id so the selection resets itself when the queue advances,
  // without an effect that could leave one alert's choices applied to the next.
  const [selection, setSelection] = useState<{ alertId: string; ids: string[] } | null>(null)
  const [composing, setComposing] = useState<{ target: Recipient | null } | null>(null)
  const [recipientEditor, setRecipientEditor] = useState<RecipientEditorState | null>(null)
  /** The alert just sent, so the board opens on the calls you queued. */
  const [focusAlertId, setFocusAlertId] = useState<string | null>(null)

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

  const pendingAlerts = useMemo(() => alertsQuery.data ?? [], [alertsQuery.data])
  // The URL names the alert; the head of the queue is only the fallback. A
  // draft prepared on the map hands its own id over, so you approve the alert
  // you just wrote rather than whichever one sorts first.
  const current =
    pendingAlerts.find((alert) => alert.id === requestedAlertId) ?? pendingAlerts[0] ?? null

  const alertRecipientsQuery = useQuery({
    queryKey: queryKeys.alertRecipients(current?.id ?? 'none'),
    queryFn: () => fetchAlertRecipients(current!.id),
    enabled: Boolean(current),
  })
  const variantsQuery = useQuery({
    queryKey: queryKeys.alertVariants(current?.id ?? 'none'),
    queryFn: () => fetchAlertVariants(current!.id),
    enabled: Boolean(current),
  })

  const deliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data])
  const byStatus = useMemo(() => {
    const groups = new Map<DeliveryStatus, Delivery[]>()
    for (const column of BOARD_COLUMNS) groups.set(column.status, [])
    for (const delivery of deliveries) groups.get(delivery.status)?.push(delivery)
    return groups
  }, [deliveries])

  const acked = deliveries.filter((delivery) => delivery.ack_status !== 'none').length
  const needsReview = byStatus.get('needs_review')?.length ?? 0

  const recipients = recipientsQuery.data ?? []
  const zones = zonesQuery.data ?? []

  // The zone-matching rule lives on the server. This screen used to keep its
  // own copy in TypeScript, so the set an operator saw and the set that got
  // called could drift apart — and only the server's copy was real.
  const defaultTargets = alertRecipientsQuery.data ?? []
  const selectedIds =
    selection && current && selection.alertId === current.id
      ? selection.ids
      : defaultTargets.map((target) => target.id)
  const selectedSet = new Set(selectedIds)

  const targetRows: TargetRow[] = [
    ...defaultTargets.map((target) => ({
      id: target.id,
      name: target.name,
      phone_e164: target.phone_e164,
      channel: target.channel,
      language: target.language,
      zone_name: target.zone_name,
      reason: target.match_reason,
      isFallback: target.variant_is_fallback,
    })),
    ...recipients
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
      })),
  ]
  const selectedRows = targetRows.filter((row) => selectedSet.has(row.id))
  const fallbackCount = defaultTargets.filter((target) => target.variant_is_fallback).length

  const setSelectedIds = (ids: string[]) => {
    if (!current) return
    setSelection({ alertId: current.id, ids })
  }
  const toggleRecipient = (id: string) => {
    setSelectedIds(
      selectedSet.has(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id],
    )
  }

  const handleComposed = (alert: Alert, recipientIds: string[] | null) => {
    // Seed the cache so the new draft is on screen before the refetch lands —
    // otherwise the fallback briefly puts a different alert under the button.
    queryClient.setQueryData<Alert[]>(queryKeys.pendingAlerts, (rows = []) =>
      rows.some((row) => row.id === alert.id) ? rows : [alert, ...rows],
    )
    if (recipientIds) setSelection({ alertId: alert.id, ids: recipientIds })
    selectAlert(alert.id)
    setComposing(null)
  }

  return (
    <Screen width="wide">
      <PageHeader
        eyebrow="Dispatch console"
        title="Approve and send"
        description="Nothing here reaches a phone until a named person signs for it — not the pipeline, not the AI advisor. Write or review the message, choose exactly who hears it, then sign."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setComposing({ target: null })}>
            New alert
          </Button>
        }
      />

      {/*
        Four large stat tiles used to sit here saying what one line says: how
        much is waiting, how much landed, how much was answered.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-bento border border-line bg-surface px-4 py-3 shadow-bento">
        <span className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold tabular-nums text-ink">
            {pendingAlerts.length}
          </span>
          <span className="text-eyebrow text-faint uppercase">waiting on you</span>
        </span>
        {needsReview > 0 ? (
          <span className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums text-warn-fg">{needsReview}</span>
            <span className="text-eyebrow text-faint uppercase">need review</span>
          </span>
        ) : null}
        <DeliveryFunnel byStatus={byStatus} total={deliveries.length} acked={acked} />
      </div>

      <BentoGrid className="mb-4 items-start">
        <BentoCard span={4} className="min-w-0">
          <div data-tour={TOUR_ANCHORS.approvalGate}>
            {alertsQuery.isLoading ? <SkeletonText lines={4} /> : null}
            {alertsQuery.isError ? <ErrorNote error={alertsQuery.error} /> : null}

            <AlertQueue
              alerts={pendingAlerts}
              selectedId={current?.id ?? null}
              onSelect={selectAlert}
            />

            {current ? (
              <>
                <AlertEditor
                  key={current.id}
                  alert={current}
                  variants={variantsQuery.data ?? []}
                />
                <SendPanel
                  key={`send-${current.id}`}
                  alert={current}
                  signer={signer}
                  onSignerChange={setSigner}
                  selectedRows={selectedRows}
                  selectedIds={selectedIds}
                  onApproved={(alertId) => {
                    setSelection(null)
                    setFocusAlertId(alertId)
                    selectAlert(null)
                  }}
                  onRejected={() => {
                    setSelection(null)
                    selectAlert(null)
                  }}
                />
              </>
            ) : !alertsQuery.isLoading ? (
              <EmptyState
                icon={Inbox}
                title="Nothing waiting at the gate"
                action={
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => setComposing({ target: null })}
                  >
                    New alert
                  </Button>
                }
              >
                Write one here, or draft it from a zone on the map. Either way it lands at
                this gate first.
              </EmptyState>
            ) : null}
          </div>
        </BentoCard>

        <BentoCard
          span={2}
          className="min-w-0 lg:sticky lg:top-20"
          eyebrow="Recipients"
          title={current ? 'Who this reaches' : 'Who this room can reach'}
        >
          <PeoplePanel
            key={current?.id ?? 'roster-only'}
            hasAlert={Boolean(current)}
            alertLanguage={current?.language ?? 'sw'}
            targetRows={targetRows}
            selectedIds={selectedSet}
            fallbackCount={fallbackCount}
            targetsLoading={alertRecipientsQuery.isLoading}
            targetsError={alertRecipientsQuery.error}
            recipients={recipients}
            recipientsLoading={recipientsQuery.isLoading}
            recipientsError={recipientsQuery.error}
            onToggleTarget={toggleRecipient}
            onSelectAll={() => setSelectedIds(targetRows.map((row) => row.id))}
            onClearSelection={() => setSelectedIds([])}
            onAddRecipient={() =>
              setRecipientEditor({ mode: 'create', zoneId: current?.zone_id ?? null })
            }
            onEditRecipient={(recipient) => setRecipientEditor({ mode: 'edit', recipient })}
            onSendTo={(recipient) => setComposing({ target: recipient })}
          />
        </BentoCard>

        <BentoCard span={6} padded={false} className="min-w-0">
          <DeliveryBoard
            key={focusAlertId ?? 'all'}
            deliveries={deliveries}
            isLoading={deliveriesQuery.isLoading}
            error={deliveriesQuery.error}
            focusAlertId={focusAlertId}
            focusLabel="Just sent"
          />
        </BentoCard>
      </BentoGrid>

      {composing ? (
        <ComposeAlertModal
          zones={zones}
          zonesLoading={zonesQuery.isLoading}
          signer={signer}
          target={composing.target}
          onClose={() => setComposing(null)}
          onCreated={handleComposed}
        />
      ) : null}

      {recipientEditor ? (
        <RecipientFormModal
          state={recipientEditor}
          zones={zones}
          onClose={() => setRecipientEditor(null)}
          onCreated={(recipient) => {
            // A number added while an alert is open was almost certainly added
            // *for* that alert.
            if (current) setSelectedIds([...selectedIds, recipient.id])
          }}
        />
      ) : null}
    </Screen>
  )
}
