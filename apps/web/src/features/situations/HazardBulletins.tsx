import { useState } from 'react'
import {
  TriangleAlert,
} from 'lucide-react'
import { Modal, DetailRow } from '../../components/Modal'
import { EmptyState, StatusChip } from '../../components/ui'
import { fmtDate, fmtDateTime } from '../../lib/format'
import { hazardMeta, HAZARD_ICONS, HAZARD_SEVERITY_META } from '../../lib/explain'
import { hazardSourceMeta } from '../../lib/hazardSources'
import type { HazardBulletin } from '../../lib/types'

/**
 * Hazard glyphs were emoji and box-drawing characters (☀ ≋ 🌡 🦗 △ ⌁ ⛰), which
 * render at wildly different weights and sizes per platform. Mapping to lucide
 * keeps them a consistent stroke weight alongside every other icon.
 */
function HazardIcon({ hazardType }: { hazardType: string }) {
  const Icon = HAZARD_ICONS[hazardType] ?? TriangleAlert
  return <Icon size={17} strokeWidth={1.75} aria-hidden />
}

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
      <ul className="m-0 grid list-none gap-2 p-0">
        {sorted.map((bulletin) => {
          const meta = hazardMeta(bulletin.hazard_type)
          const severity = HAZARD_SEVERITY_META[bulletin.severity]
          const active = isActive(bulletin)
          const source = hazardSourceMeta(bulletin.source)
          return (
            <li key={bulletin.id}>
              <button
                type="button"
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-line border-l-4 bg-surface px-3 py-2.5 text-left transition-[background,box-shadow,transform] hover:-translate-y-px hover:bg-surface-2 hover:shadow-md"
                style={{ borderLeftColor: meta.color }}
                onClick={() => setSelected(bulletin)}
              >
                <span className="text-lg leading-none" style={{ color: meta.color }}>
                  <HazardIcon hazardType={bulletin.hazard_type} />
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
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
                  <span className="text-sm leading-snug text-ink">{bulletin.headline}</span>
                  <small className="text-muted">
                    {fmtDate(bulletin.valid_from)} →{' '}
                    {bulletin.valid_to ? fmtDate(bulletin.valid_to) : 'open-ended'} ·{' '}
                    {source.isSeeded ? (
                      <>
                        Illustrative bulletin (seeded) — modeled on{' '}
                        {source.name}
                        , not a live-issued advisory
                      </>
                    ) : (
                      <>Source: {source.name}</>
                    )}
                  </small>
                </span>
                <span className="text-xl text-faint" aria-hidden="true">
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

export function HazardDetailModal({
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
      <div className="flex flex-wrap gap-1.5">
        <StatusChip tone={severity?.tone ?? 'info'}>
          {severity?.label ?? bulletin.severity}
        </StatusChip>
        <StatusChip tone={isActive(bulletin) ? 'success' : 'neutral'}>
          {isActive(bulletin) ? 'active now' : 'expired'}
        </StatusChip>
      </div>

      <p className="m-0 text-sm leading-relaxed text-ink">{meta.description}</p>
      <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
        {hazardSourceMeta(bulletin.source).isSeeded
          ? 'Illustrative bulletin (seeded) — modeled on '
          : 'Source: '}
        {hazardSourceMeta(bulletin.source).url ? (
          <a
            href={hazardSourceMeta(bulletin.source).url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent hover:text-accent-hover"
          >
            {hazardSourceMeta(bulletin.source).name}
          </a>
        ) : (
          hazardSourceMeta(bulletin.source).name
        )}
        {hazardSourceMeta(bulletin.source).isSeeded
          ? ', not a live-issued advisory.'
          : null}
      </p>
      {severity ? (
        <p className="m-0 text-sm leading-relaxed text-ink">
          <strong>{severity.label}:</strong> {severity.meaning}
        </p>
      ) : null}

      {bulletin.detail ? (
        <div className="grid gap-1.5">
          <h3>Bulletin detail</h3>
          <p className="m-0 text-sm leading-relaxed text-ink">{bulletin.detail}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-2">
        <DetailRow label="Affected zone">{zoneName ?? '—'}</DetailRow>
        <DetailRow label="Valid from">{fmtDate(bulletin.valid_from)}</DetailRow>
        <DetailRow label="Valid until">
          {bulletin.valid_to ? fmtDate(bulletin.valid_to) : 'Open-ended'}
        </DetailRow>
        <DetailRow label="Source">
          {hazardSourceMeta(bulletin.source).name}
        </DetailRow>
        <DetailRow label="Available to system">
          {fmtDateTime(bulletin.available_at)}
        </DetailRow>
      </div>

      {meta.actions.length > 0 ? (
        <div className="grid gap-1.5 rounded-lg border border-accent-ring bg-accent-soft px-3.5 py-3">
          <h3>Recommended preparedness actions</h3>
          <ul className="m-0 grid list-disc gap-1.5 pl-5 text-sm leading-relaxed">
            {meta.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  )
}
