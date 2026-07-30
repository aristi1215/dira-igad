import { useState } from 'react'
import { Check, MessageSquare, PhoneOutgoing, Plus, Radio, X } from 'lucide-react'
import { Button, Callout } from '../../components/ui'
import { advisorDispatch, prepareAlert, verifyFieldReport } from '../../lib/api'
import type { AdvisorProposal } from '../../lib/types'

export function ProposalCard({
  proposal,
  onDismiss,
}: {
  proposal: AdvisorProposal
  onDismiss: () => void
}) {
  const [operator, setOperator] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dispatchDeliveries, setDispatchDeliveries] = useState<number | null>(null)
  const [dispatchNumbers, setDispatchNumbers] = useState<string[]>(
    proposal.phone_numbers?.length ? proposal.phone_numbers : [''],
  )
  const [dispatchChannel, setDispatchChannel] = useState<'voice' | 'sms' | 'both'>(
    proposal.channel ?? 'voice',
  )

  const confirm = async () => {
    setPending(true)
    setError(null)
    try {
      if (proposal.type === 'verify-field-report' && proposal.report_id) {
        await verifyFieldReport(proposal.report_id, operator.trim())
      } else if (proposal.type === 'alert-draft' && proposal.situation_id) {
        await prepareAlert(proposal.situation_id)
      } else if (proposal.type === 'dispatch' && proposal.situation_id) {
        const result = await advisorDispatch({
          situation_id: proposal.situation_id,
          phone_numbers: dispatchNumbers.map((number) => number.trim()),
          channel: dispatchChannel,
          language: proposal.language,
          approved_by: operator.trim(),
        })
        setDispatchDeliveries(result.deliveries)
      } else {
        throw new Error('Incomplete proposal')
      }
      setDone(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply suggestion.')
    } finally {
      setPending(false)
    }
  }

  if (done) {
    if (proposal.type === 'dispatch') {
      const deliveryCount =
        dispatchDeliveries ??
        (dispatchChannel === 'both' ? dispatchNumbers.length * 2 : dispatchNumbers.length)
      return (
        <div className="rounded-md border border-ok-fg/30 bg-ok-bg px-3 py-2 text-xs text-ok-fg">
          Dispatched {deliveryCount}{' '}
          {deliveryCount === 1 ? 'delivery' : 'deliveries'} — track them on the Dispatch screen.
        </div>
      )
    }
    return (
      <div className="rounded-md border border-ok-fg/30 bg-ok-bg px-3 py-2 text-xs text-ok-fg">
        Suggestion applied. Review the updated record in the situation room.
      </div>
    )
  }

  const verifying = proposal.type === 'verify-field-report'
  const dispatching = proposal.type === 'dispatch'
  const validDispatchNumbers = dispatchNumbers.filter((number) =>
    /^\+[1-9][0-9]{7,14}$/.test(number.trim()),
  )
  const DispatchIcon =
    dispatchChannel === 'sms'
      ? MessageSquare
      : dispatchChannel === 'both'
        ? Radio
        : PhoneOutgoing
  return (
    <div
      className={
        dispatching
          ? 'grid gap-3 rounded-lg border border-warn-fg/40 bg-warn-bg px-3 py-3'
          : 'grid gap-2 rounded-lg border border-accent-ring bg-accent-soft px-3 py-3'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={dispatching ? 'text-eyebrow text-warn-fg' : 'text-eyebrow text-accent'}>
            {dispatching ? 'Dispatch alert · human-gated' : 'Suggested next step'}
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {dispatching
              ? dispatchChannel === 'sms'
                ? 'Send an SMS'
                : dispatchChannel === 'both'
                  ? 'Call + SMS'
                  : 'Place a voice call'
              : verifying
                ? 'Review this field report'
                : 'Prepare an alert draft'}
          </p>
          {proposal.reason ? <p className="mt-1 text-xs text-muted">{proposal.reason}</p> : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink"
          aria-label="Dismiss suggestion"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      {dispatching ? (
        <>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-eyebrow text-muted uppercase">Target numbers</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={Plus}
                onClick={() => setDispatchNumbers((numbers) => [...numbers, ''])}
              >
                Add number
              </Button>
            </div>
            {dispatchNumbers.map((number, index) => {
              const invalid = number.trim().length > 0 && !/^\+[1-9][0-9]{7,14}$/.test(number.trim())
              return (
                <div key={`dispatch-number-${index}`} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      value={number}
                      onChange={(event) =>
                        setDispatchNumbers((numbers) =>
                          numbers.map((current, itemIndex) =>
                            itemIndex === index ? event.target.value : current,
                          ),
                        )
                      }
                      placeholder="+2547XXXXXXXX"
                      aria-label={`Target phone number ${index + 1}`}
                      className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-2 text-sm tabular-nums text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                    />
                    {dispatchNumbers.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        icon={X}
                        aria-label={`Remove target number ${index + 1}`}
                        onClick={() =>
                          setDispatchNumbers((numbers) =>
                            numbers.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        <span className="sr-only">Remove</span>
                      </Button>
                    ) : null}
                  </div>
                  {invalid ? (
                    <p className="text-2xs text-err-fg">
                      Use an international number such as +2547XXXXXXXX.
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
          <label className="grid gap-1.5">
            <span className="text-eyebrow text-muted uppercase">Channel</span>
            <select
              value={dispatchChannel}
              onChange={(event) =>
                setDispatchChannel(event.target.value as 'voice' | 'sms' | 'both')
              }
              className="h-8.5 w-full rounded-md border border-line bg-surface px-2.5 text-sm text-ink focus:border-accent focus:outline-none"
            >
              <option value="voice">Voice call</option>
              <option value="sms">SMS</option>
              <option value="both">Voice + SMS</option>
            </select>
          </label>
          {dispatchChannel !== 'voice' ? (
            <Callout tone="warning" icon={DispatchIcon}>
              Custom-body SMS is blocked on Twilio trial accounts; voice is the reliable channel.
            </Callout>
          ) : null}
        </>
      ) : null}
      {verifying ? (
        <input
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
          placeholder="Your name to confirm"
          aria-label="Your name to confirm"
          className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      ) : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {dispatching ? (
        <input
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
          placeholder="Operator name (required to dispatch)"
          aria-label="Operator name required to dispatch"
          className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={pending}
          disabled={
            dispatching
              ? operator.trim().length === 0 || validDispatchNumbers.length === 0
              : verifying && operator.trim().length === 0
          }
          icon={Check}
          onClick={() => void confirm()}
        >
          {dispatching ? 'Confirm & dispatch' : 'Confirm'}
        </Button>
      </div>
    </div>
  )
}
