import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchZoneSignals, queryKeys } from '../../lib/api'
import { fmtDate, titleCase } from '../../lib/format'
import type { ZoneSignal } from '../../lib/types'
import { SignalDetailModal } from './SignalDetailModal'

type SignalsListProps = {
  zoneId: string | null
  zoneName?: string | null
}

const STATUS_CLASSES: Record<string, string> = {
  unconfirmed: 'bg-warn-bg text-warn-fg',
  needs_review: 'bg-err-bg text-err-fg',
  failed: 'bg-err-bg text-err-fg',
  delivered: 'bg-ok-bg text-ok-fg',
  verified: 'bg-ok-bg text-ok-fg',
  dismissed: 'bg-surface-2 text-faint',
}

export function SignalsList({ zoneId, zoneName }: SignalsListProps) {
  const [selected, setSelected] = useState<ZoneSignal | null>(null)
  const signalsQuery = useQuery({
    queryKey: queryKeys.zoneSignals(zoneId ?? 'none'),
    queryFn: () => fetchZoneSignals(zoneId ?? ''),
    enabled: zoneId != null,
  })

  if (!zoneId) return null
  const signals = signalsQuery.data ?? []

  return (
    <div aria-label="Reports in the news">
      {signalsQuery.isLoading ? <p className="my-2 text-sm text-faint">Loading reports…</p> : null}
      {!signalsQuery.isLoading && signals.length === 0 ? (
        <p className="m-0 py-4 text-center text-sm text-faint">No reports in the news for this zone.</p>
      ) : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {signals.slice(0, 6).map((signal) => (
          <li key={signal.id} className="rounded-md border border-line bg-surface px-3 py-2.5 transition-[background,border-color,box-shadow] hover:border-line-strong hover:bg-surface-2 hover:shadow-md">
            <button
              type="button"
              className="grid w-full gap-1 text-left"
              onClick={() => setSelected(signal)}
            >
              <span className="flex w-full items-center gap-2">
                <span className="text-xs font-semibold capitalize text-accent">{titleCase(signal.signal_type)}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_CLASSES[signal.status] ?? 'bg-info-bg text-info-fg'}`}>
                  {signal.status}
                </span>
                <strong>{Math.round(signal.confidence * 100)}%</strong>
              </span>
              {signal.title ? <span className="mt-0.5 text-sm">{signal.title}</span> : null}
              <small className="text-muted">
                {[signal.source, signal.published_at ? fmtDate(signal.published_at) : null]
                  .filter(Boolean)
                  .join(' · ') || 'Source pending'}
                {signal.url ? ' · has source link' : ''}
                {' · click for full context'}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <SignalDetailModal
          signal={selected}
          zoneName={zoneName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  )
}
