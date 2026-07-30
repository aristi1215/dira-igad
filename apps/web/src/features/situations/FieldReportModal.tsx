import { Modal, DetailRow } from '../../components/Modal'
import { StatusChip } from '../../components/ui'
import { fmtDateTime, titleCase } from '../../lib/format'
import { reportCategoryMeta, REPORTER_ROLE_META } from '../../lib/explain'
import type { FieldReport } from '../../lib/types'

const STATUS_TONE = {
  verified: 'success',
  unverified: 'warning',
  dismissed: 'neutral',
} as const

const STATUS_MEANING: Record<FieldReport['status'], string> = {
  verified:
    'A named duty officer vouched for this report — it contributes to field evidence on the next assessment cycle.',
  unverified:
    'Awaiting human verification. Unverified reports contribute exactly 0 to the combined score — a raw report alone never moves the operational band.',
  dismissed:
    'Reviewed and dismissed by a named officer. Dismissed reports contribute exactly 0 to the combined score.',
}

const SEVERITY_LABELS: Record<number, string> = {
  1: '1 — Low (routine observation)',
  2: '2 — Medium (developing concern)',
  3: '3 — High (urgent, verified impact)',
}

export function FieldReportModal({
  report,
  zoneName,
  onClose,
}: {
  report: FieldReport
  zoneName?: string | null
  onClose: () => void
}) {
  return (
    <Modal
      eyebrow="Field report · CEWARN monitor network"
      title={titleCase(report.category)}
      onClose={onClose}
      wide
    >
      <div className="flex flex-wrap gap-1.5">
        <StatusChip tone={STATUS_TONE[report.status]}>{report.status}</StatusChip>
        <StatusChip tone={report.severity >= 3 ? 'error' : report.severity === 2 ? 'warning' : 'neutral'}>
          Severity {report.severity}/3
        </StatusChip>
      </div>

      <p className="m-0 text-sm leading-relaxed text-ink">{reportCategoryMeta(report.category)}</p>

      <div className="grid gap-1.5">
        <h3>Narrative</h3>
        <blockquote className="m-0 rounded-r-md border-l-[3px] border-accent bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-ink">“{report.narrative}”</blockquote>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-2">
        <DetailRow label="Zone">
          {zoneName ?? report.zone_name ?? report.zone_id ?? '—'}
        </DetailRow>
        <DetailRow label="Reporter">
          {titleCase(report.reporter_role)}
          {REPORTER_ROLE_META[report.reporter_role] ? (
            <small className="mt-px block text-xs text-faint">
              {REPORTER_ROLE_META[report.reporter_role]}
            </small>
          ) : null}
        </DetailRow>
        <DetailRow label="Severity">
          {SEVERITY_LABELS[report.severity] ?? `${report.severity}/3`}
        </DetailRow>
        <DetailRow label="Reported">{fmtDateTime(report.reported_at)}</DetailRow>
        <DetailRow label="Available to system">
          {fmtDateTime(report.available_at)}
        </DetailRow>
        <DetailRow label={report.status === 'dismissed' ? 'Dismissed by' : 'Verified by'}>
          {report.verified_by ?? '—'}
          {report.verified_at ? (
            <small className="mt-px block text-xs text-faint">{fmtDateTime(report.verified_at)}</small>
          ) : null}
        </DetailRow>
      </div>

      <div className="grid gap-1.5 rounded-lg border border-accent-ring bg-accent-soft px-3.5 py-3">
        <h3>How this affects the risk score</h3>
        <p>{STATUS_MEANING[report.status]}</p>
        {report.status === 'verified' ? (
          <p>
            Verified reports set the field evidence channel by a written
            rule: base 0.35 for any verified report, +0.15 per severity step of
            the worst report, +0.05 per extra report (max 3), capped at 0.90. The
            channel is merged with news as <code>max(news, field)</code> and
            weighted at 30% of the operational score.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
