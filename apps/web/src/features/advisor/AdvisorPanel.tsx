/** Advisor panel: shows the LLM/template draft and the human-gate approval control. */
import { useState } from 'react'

import { useApprove } from '../../hooks/queries'
import type { AlertDraft } from '../../lib/types'

interface Props {
  draft: AlertDraft
  onApproved: (deliveries: number) => void
}

export function AdvisorPanel({ draft, onApproved }: Props) {
  const [approvedBy, setApprovedBy] = useState('')
  const approve = useApprove()

  const isApproved = draft.status === 'approved' || approve.isSuccess

  return (
    <div className="card">
      <h3>Advisor — draft alert</h3>
      <p className="muted">The LLM proposes; only a human approves (do-no-harm copy).</p>
      <blockquote className="draft">{draft.draft_text}</blockquote>

      {!isApproved ? (
        <div className="approve-row">
          <input
            className="input"
            placeholder="Your name (approver)"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={approvedBy.trim() === '' || approve.isPending}
            onClick={() =>
              approve.mutate(
                { alertId: draft.id, approvedBy: approvedBy.trim() },
                { onSuccess: (r) => onApproved(r.deliveries_created) },
              )
            }
          >
            {approve.isPending ? 'Approving…' : 'Approve & dispatch'}
          </button>
        </div>
      ) : (
        <p className="approved-note">Approved — deliveries queued.</p>
      )}
      {approve.isError && <p className="error">Approval failed (already approved?).</p>}
    </div>
  )
}
