import { useState } from 'react'
import { Modal, DetailRow } from '../../components/Modal'
import { EmptyState, StatusChip } from '../../components/ui'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { hazardMeta, HAZARD_SEVERITY_META } from '../../lib/explain'
import type { HazardBulletin } from '../../lib/types'

function isActive(bulletin: HazardBulletin, now = new Date()): boolean {
  const from = new Date(bulletin.valid_from)
  const to = bulletin.valid_to ? new Date(bulletin.valid_to) : null
  return from <= now && (to === null || to >= now)
}

export function HazardBulletins({
  bulletins,
  zoneName,
}: {
  bulletins: HazardBulletin[]
  zoneName?: string | null
}) {
  const [selected, setSelected] = useState<HazardBulletin | null>(null)

  if (bulletins.length === 0) {
    return <EmptyState>No active or recent bulletins for this zone.</EmptyState>
  }

  const sorted = [...bulletins].sort((a, b) => {
    const activeDiff = Number(isActive(b)) - Number(isActive(a))
    if (activeDiff !== 0) return activeDiff
    return b.valid_from.localeCompare(a.valid_from)
  })

  return (
    <>
      <ul className="hazard-list">
        {sorted.map((bulletin) => {
          const meta = hazardMeta(bulletin.hazard_type)
          const severity = HAZARD_SEVERITY_META[bulletin.severity]
          const active = isActive(bulletin)
          return (
            <li key={bulletin.id}>
              <button
                type="button"
                className="hazard-card"
                style={{ borderLeftColor: meta.color }}
                onClick={() => setSelected(bulletin)}
              >
                <span className="hazard-icon" style={{ color: meta.color }}>
                  {meta.icon}
                </span>
                <span className="hazard-main">
                  <span className="hazard-head">
                    <strong>{meta.label}</strong>
                    <StatusChip tone={severity?.tone ?? 'info'}>
                      {bulletin.severity}
                    </StatusChip>
                    {active ? (
                      <StatusChip tone="success">active</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">expired</StatusChip>
                    )}
                  </span>
                  <span className="hazard-headline">{bulletin.headline}</span>
                  <small className="muted">
                    {fmtDate(bulletin.valid_from)} →{' '}
                    {bulletin.valid_to ? fmtDate(bulletin.valid_to) : 'open-ended'} ·{' '}
                    {bulletin.source}
                  </small>
                </span>
                <span className="hazard-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {selected ? (
        <HazardDetailModal
          bulletin={selected}
          zoneName={zoneName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  )
}

function HazardDetailModal({
  bulletin,
  zoneName,
  onClose,
}: {
  bulletin: HazardBulletin
  zoneName?: string | null
  onClose: () => void
}) {
  const meta = hazardMeta(bulletin.hazard_type)
  const severity = HAZARD_SEVERITY_META[bulletin.severity]
  return (
    <Modal
      eyebrow={`Hazard bulletin · ${meta.label}`}
      title={bulletin.headline}
      onClose={onClose}
      wide
    >
      <div className="detail-chips">
        <StatusChip tone={severity?.tone ?? 'info'}>
          {severity?.label ?? bulletin.severity}
        </StatusChip>
        <StatusChip tone={isActive(bulletin) ? 'success' : 'neutral'}>
          {isActive(bulletin) ? 'active now' : 'expired'}
        </StatusChip>
      </div>

      <p className="detail-lede">{meta.description}</p>
      {severity ? (
        <p className="detail-body">
          <strong>{severity.label}:</strong> {severity.meaning}
        </p>
      ) : null}

      {bulletin.detail ? (
        <div className="detail-section">
          <h3>Bulletin detail</h3>
          <p className="detail-body">{bulletin.detail}</p>
        </div>
      ) : null}

      <div className="detail-grid">
        <DetailRow label="Affected zone">{zoneName ?? '—'}</DetailRow>
        <DetailRow label="Valid from">{fmtDate(bulletin.valid_from)}</DetailRow>
        <DetailRow label="Valid until">
          {bulletin.valid_to ? fmtDate(bulletin.valid_to) : 'Open-ended'}
        </DetailRow>
        <DetailRow label="Issuing source">{bulletin.source}</DetailRow>
        <DetailRow label="Available to system">
          {fmtDateTime(bulletin.available_at)}
        </DetailRow>
      </div>

      {meta.actions.length > 0 ? (
        <div className="detail-section detail-note">
          <h3>Recommended preparedness actions</h3>
          <ul className="action-list">
            {meta.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  )
}
