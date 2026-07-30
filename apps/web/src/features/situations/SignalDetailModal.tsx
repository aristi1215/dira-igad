import { Modal, DetailRow } from '../../components/Modal'
import { StatusChip, ScoreMeter } from '../../components/ui'
import { fmtDateTime, titleCase } from '../../lib/format'
import { signalTypeMeta } from '../../lib/explain'
import type { ZoneSignal } from '../../lib/types'

function maybeLink(value: string) {
  if (/^https?:\/\//.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    )
  }
  return value
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
      <div className="flex flex-wrap gap-1.5">
        <StatusChip tone={signal.status === 'confirmed' ? 'success' : 'neutral'}>
          {signal.status}
        </StatusChip>
        <StatusChip tone="info">{titleCase(signal.signal_type)}</StatusChip>
      </div>

      <p className="m-0 text-sm leading-relaxed text-ink">{signalTypeMeta(signal.signal_type)}</p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-2">
        <DetailRow label="Extraction confidence">
        <span className="inline-flex w-full items-center gap-2">
            <ScoreMeter value={signal.confidence} />
            <strong>{Math.round(signal.confidence * 100)}%</strong>
          </span>
        </DetailRow>
        <DetailRow label="Zone">{zoneName ?? signal.zone_id}</DetailRow>
        <DetailRow label="Assessment cycle">{signal.cycle}</DetailRow>
        <DetailRow label="Source outlet">{signal.source ?? '—'}</DetailRow>
        <DetailRow label="Published">{fmtDateTime(signal.published_at)}</DetailRow>
        <DetailRow label="Available to system">
          {fmtDateTime(signal.available_at)}
        </DetailRow>
        {signal.external_id ? (
          <DetailRow label="Document reference">
            {maybeLink(signal.external_id)}
          </DetailRow>
        ) : null}
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
        <h3>How this affects the risk score</h3>
        <p>
          Reports in the news provide <strong>supporting evidence only</strong> — they
          never enter the quantitative model. The strongest report confidence in
          the zone sets the news evidence value, which is merged with
          verified field reports as <code>max(news, field)</code> and then
          weighted at 30% in the combined score. A report alone can never move
          the band by more than that written rule allows.
        </p>
      </div>
    </Modal>
  )
}
