import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button, Callout } from '../../components/ui'
import { prepareAlert, verifyFieldReport } from '../../lib/api'
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

  const confirm = async () => {
    setPending(true)
    setError(null)
    try {
      if (proposal.type === 'verify-field-report' && proposal.report_id) {
        await verifyFieldReport(proposal.report_id, operator.trim())
      } else if (proposal.type === 'alert-draft' && proposal.situation_id) {
        await prepareAlert(proposal.situation_id)
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
    return (
      <div className="rounded-md border border-ok-fg/30 bg-ok-bg px-3 py-2 text-xs text-ok-fg">
        Suggestion applied. Review the updated record in the situation room.
      </div>
    )
  }

  const verifying = proposal.type === 'verify-field-report'
  return (
    <div className="grid gap-2 rounded-lg border border-accent-ring bg-accent-soft px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-eyebrow text-accent">Suggested next step</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {verifying ? 'Review this field report' : 'Prepare an alert draft'}
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
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={pending}
          disabled={verifying && operator.trim().length === 0}
          icon={Check}
          onClick={() => void confirm()}
        >
          Confirm
        </Button>
      </div>
    </div>
  )
}
