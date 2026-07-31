import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Lock, PhoneOutgoing } from 'lucide-react'
import { approveAlert, queryKeys, rejectAlert } from '../../lib/api'
import {
  Button,
  ErrorNote,
  Field,
  Stat,
  StatRow,
  TextInput,
} from '../../components/ui'
import { Modal } from '../../components/Modal'
import type { Alert } from '../../lib/types'
import { deliveriesFor, type TargetRow } from './constants'

const TEXTAREA =
  'w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent-ring/40'

/**
 * The gate, expressed as one action.
 *
 * The approver's name used to sit in a `Field` several rows above the button,
 * looking like any other form input — so "why is Approve disabled?" was a
 * question this screen asked people to answer by hunting. The name is now part
 * of signing: it is shown attached to the button when known, and asked for as
 * the first thing in the confirmation when it is not. Same column in the
 * database, same timestamp, same CHECK constraint — only the choreography
 * changed.
 */
export function SendPanel({
  alert,
  signer,
  onSignerChange,
  selectedRows,
  selectedIds,
  onApproved,
  onRejected,
}: {
  alert: Alert
  signer: string
  onSignerChange: (value: string) => void
  selectedRows: TargetRow[]
  selectedIds: string[]
  onApproved: (alertId: string) => void
  onRejected: (alertId: string) => void
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [draftSigner, setDraftSigner] = useState(signer)
  const signerInputRef = useRef<HTMLInputElement>(null)

  const channelMix = deliveriesFor(selectedRows)
  const expectedDeliveryCount = channelMix.voice + channelMix.sms
  const named = signer.trim().length > 1
  const draftNamed = draftSigner.trim().length > 1

  // `autoFocus` loses this race: the Modal's focus trap moves focus to the
  // first control in the dialog, which is its close button. When we do not
  // know who is signing, the name is the thing being asked for, so it takes
  // the cursor on the next frame.
  useEffect(() => {
    if (!confirming || named) return
    const frame = requestAnimationFrame(() => signerInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [confirming, named])

  const dropFromQueue = (alertId: string) => {
    queryClient.setQueryData<Alert[]>(queryKeys.pendingAlerts, (current = []) =>
      current.filter((row) => row.id !== alertId),
    )
    void queryClient.invalidateQueries({ queryKey: queryKeys.allAlerts })
  }

  const approveMutation = useMutation({
    mutationFn: (input: { approvedBy: string }) =>
      approveAlert(alert.id, input.approvedBy, selectedIds),
    onSuccess: (response) => {
      dropFromQueue(response.id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.deliveries })
      setConfirming(false)
      onApproved(response.id)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (input: { rejectedBy: string; reason: string }) =>
      rejectAlert(alert.id, input.rejectedBy, input.reason),
    onSuccess: (response) => {
      dropFromQueue(response.id)
      setRejecting(false)
      setRejectReason('')
      onRejected(response.id)
    },
  })

  const openConfirm = () => {
    setDraftSigner(signer)
    setConfirming(true)
  }
  const openReject = () => {
    setDraftSigner(signer)
    setRejecting(true)
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      {named ? (
        <p className="mb-2 text-xs text-muted">
          Signing as <span className="font-medium text-ink">{signer.trim()}</span>
          {' · '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-ink"
            onClick={() => onSignerChange('')}
          >
            not you?
          </button>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={PhoneOutgoing}
          disabled={selectedRows.length === 0}
          title={selectedRows.length === 0 ? 'Select at least one recipient' : undefined}
          onClick={openConfirm}
        >
          {named
            ? `Sign & send ${expectedDeliveryCount} deliver${
                expectedDeliveryCount === 1 ? 'y' : 'ies'
              }`
            : 'Sign & send…'}
        </Button>
        <Button variant="ghost" icon={Ban} onClick={openReject}>
          Reject
        </Button>
        <p className="flex items-center gap-1.5 text-2xs text-faint">
          <Lock size={11} strokeWidth={1.75} aria-hidden />
          Either way, recorded with your name and a timestamp
        </p>
      </div>

      {approveMutation.isError ? (
        <ErrorNote error={approveMutation.error} className="mt-3" />
      ) : null}

      {confirming ? (
        <Modal title="Send this alert?" eyebrow="Confirm dispatch" onClose={() => setConfirming(false)}>
          {/*
            The one deliberate beat before real phones ring. It restates what is
            about to happen in the operator's own terms — not a generic "are you
            sure", which teaches people to click through.
          */}
          <form
            className="grid gap-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              if (!draftNamed) return
              onSignerChange(draftSigner)
              approveMutation.mutate({ approvedBy: draftSigner.trim() })
            }}
          >
            <StatRow>
              <Stat label="Recipients" value={selectedRows.length} />
              <Stat label="Voice calls" value={channelMix.voice} />
              <Stat label="SMS" value={channelMix.sms} />
            </StatRow>
            <blockquote className="rounded-md border border-line border-l-[3px] border-l-accent bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink">
              {alert.body_text}
            </blockquote>
            <Field
              label="Sign with your name"
              htmlFor="confirm-signer"
              hint="Stored on the alert with the time. This is the human gate."
            >
              <TextInput
                id="confirm-signer"
                ref={signerInputRef}
                required
                value={draftSigner}
                placeholder="Your full name"
                autoComplete="name"
                onChange={(event) => setDraftSigner(event.target.value)}
              />
            </Field>
            <p className="text-xs text-faint">
              Sending in {alert.language.toUpperCase()}. This cannot be undone — queued
              deliveries start dispatching immediately.
            </p>
            {approveMutation.isError ? <ErrorNote error={approveMutation.error} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                icon={PhoneOutgoing}
                disabled={!draftNamed}
                loading={approveMutation.isPending}
              >
                {approveMutation.isPending ? 'Sending…' : 'Yes, send it'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {rejecting ? (
        <Modal title="Reject this alert" eyebrow="Human gate" onClose={() => setRejecting(false)}>
          <form
            className="grid gap-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              if (!draftNamed) return
              onSignerChange(draftSigner)
              rejectMutation.mutate({
                rejectedBy: draftSigner.trim(),
                reason: rejectReason.trim(),
              })
            }}
          >
            <p className="text-sm text-muted">
              Nothing is queued and nothing is sent. The alert is closed on the record
              under your name, so a decision not to warn is as auditable as a decision to
              warn.
            </p>
            <Field
              label="Why?"
              htmlFor="reject-reason"
              hint="Optional, but it is what the next reader sees."
            >
              <textarea
                id="reject-reason"
                rows={3}
                maxLength={2000}
                value={rejectReason}
                placeholder="Duplicate of this morning's alert…"
                onChange={(event) => setRejectReason(event.target.value)}
                className={TEXTAREA}
              />
            </Field>
            <Field label="Sign with your name" htmlFor="reject-signer">
              <TextInput
                id="reject-signer"
                required
                value={draftSigner}
                placeholder="Your full name"
                autoComplete="name"
                onChange={(event) => setDraftSigner(event.target.value)}
              />
            </Field>
            {rejectMutation.isError ? <ErrorNote error={rejectMutation.error} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                icon={Ban}
                disabled={!draftNamed}
                loading={rejectMutation.isPending}
              >
                Reject alert
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}
