import { ExternalLink, Link2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Modal, DetailRow } from '../../components/Modal'
import { DateStamp, InfoHint, StatusChip } from '../../components/ui'
import { fmtDate, fmtDateTime, titleCase } from '../../lib/format'
import { signalTypeMeta } from '../../lib/explain'
import type { ZoneSignal } from '../../lib/types'

function maybeLink(value: string) {
  if (/^https?:\/\//.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 font-medium text-accent hover:text-accent-hover"
      >
        <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
        Open source
      </a>
    )
  }
  return <span className="text-muted">{value}</span>
}

export function SignalDetailModal({
  signal,
  zoneName,
  onClose,
}: {
  signal: ZoneSignal
  zoneName?: string | null
  onClose: () => void
}) {
  return (
    <Modal
      eyebrow="Report in the news · supporting evidence"
      title={signal.title ?? titleCase(signal.signal_type)}
      onClose={onClose}
      wide
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip
          tone={
            signal.status === 'confirmed'
              ? 'success'
              : signal.status === 'dismissed'
                ? 'neutral'
                : 'warning'
          }
          className="px-2.5 py-1 text-xs font-semibold"
        >
          {signal.status === 'confirmed' ? <ShieldCheck size={14} strokeWidth={1.9} aria-hidden /> : <TriangleAlert size={14} strokeWidth={1.9} aria-hidden />}
          {signal.status}
        </StatusChip>
        <StatusChip tone="info" className="px-2.5 py-1 text-xs font-semibold">{titleCase(signal.signal_type)}</StatusChip>
        <StatusChip tone={signal.confidence >= 0.7 ? 'success' : 'warning'} className="px-2.5 py-1 text-xs font-semibold">
          Confidence {Math.round(signal.confidence * 100)}%
        </StatusChip>
      </div>

      <p className="m-0 text-sm leading-relaxed text-ink">{signalTypeMeta(signal.signal_type)}</p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-2">
        <DetailRow label="Zone">{zoneName ?? signal.zone_id}</DetailRow>
        <DetailRow label="Assessment cycle">{signal.cycle}</DetailRow>
        <DetailRow label="Source outlet">{signal.source ?? '—'}</DetailRow>
        <DetailRow label="Published">
          <DateStamp>{fmtDate(signal.published_at)}</DateStamp>
        </DetailRow>
        <DetailRow label="Available to system">
          {fmtDateTime(signal.available_at)}
        </DetailRow>
        <DetailRow label="Source document">
          {signal.url ? (
            maybeLink(signal.url)
          ) : signal.external_id && /^https?:\/\//.test(signal.external_id) ? (
            maybeLink(signal.external_id)
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Link2 size={14} strokeWidth={1.75} aria-hidden />
              {signal.external_id ?? 'No public link for this item'}
            </span>
          )}
        </DetailRow>
        <DetailRow label="Extracted">{fmtDateTime(signal.created_at)}</DetailRow>
      </div>

      {signal.excerpt ? (
        <div className="grid gap-1.5">
          <h3>Supporting excerpt</h3>
          <blockquote className="m-0 rounded-r-md border-l-[3px] border-accent bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-ink">“{signal.excerpt}”</blockquote>
        </div>
      ) : null}

      {signal.body_excerpt ? (
        <div className="grid gap-1.5">
          <h3>Source article (opening)</h3>
          <p className="m-0 text-sm leading-relaxed text-ink">{signal.body_excerpt}…</p>
        </div>
      ) : null}

      <div className="grid gap-1.5 rounded-lg border border-accent-ring bg-accent-soft px-3.5 py-3">
        <h3 className="flex items-center gap-1.5">How this affects the risk score <InfoHint content="The combined score uses 70% model risk and 30% corroboration." /></h3>
        <p>
          This signal contributes to corroboration when it is confirmed. News and
          verified field reports are merged by taking the stronger channel, then
          corroboration receives 30% of the combined score alongside 70% model
          risk. If corroboration reaches its threshold while the score is at least
          elevated, the written combination rule can bump the operational band.
        </p>
      </div>
    </Modal>
  )
}
