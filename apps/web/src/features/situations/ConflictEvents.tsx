import { useMemo, useState } from 'react'
import { Modal, DetailRow } from '../../components/Modal'
import { EmptyState, StatusChip } from '../../components/ui'
import { fmtDate, fmtDateTime } from '../../lib/format'
import type { AcledEventRow } from '../../lib/types'

const EVENT_TYPE_META: Record<string, string> = {
  Battles: 'Armed clash between organised groups.',
  'Violence against civilians': 'Attack by an armed group on unarmed civilians.',
  Riots: 'Violent demonstration or mob violence.',
  Protest: 'Public demonstration, non-violent by coding.',
  Protests: 'Public demonstration, non-violent by coding.',
  'Explosions/Remote violence': 'IED, shelling or other remote violence.',
  'Strategic developments': 'Non-violent but conflict-relevant development.',
}

type EventWithContribution = AcledEventRow & {
  recencyDays: number
  inWindow: boolean
  windowShare: number | null
}

/**
 * Recent conflict events with per-event context on how they feed the model.
 * Events inside the trailing 90-day window feed the incident-count and trend
 * features; the share column is each event's fraction of that window's events.
 */
export function ConflictEvents({
  events,
  zoneName,
}: {
  events: AcledEventRow[]
  zoneName?: string | null
}) {
  const [selected, setSelected] = useState<EventWithContribution | null>(null)

  const enriched = useMemo<EventWithContribution[]>(() => {
    if (events.length === 0) return []
    const newest = events.reduce(
      (max, e) => (e.event_date > max ? e.event_date : max),
      events[0].event_date,
    )
    const anchor = new Date(newest).getTime()
    const withRecency = events.map((event) => {
      const recencyDays = Math.max(
        0,
        Math.round((anchor - new Date(event.event_date).getTime()) / 86_400_000),
      )
      return { ...event, recencyDays, inWindow: recencyDays <= 90 }
    })
    const windowCount = withRecency.filter((e) => e.inWindow).length
    return withRecency.map((event) => ({
      ...event,
      windowShare: event.inWindow && windowCount > 0 ? 1 / windowCount : null,
    }))
  }, [events])

  if (enriched.length === 0) {
    return <EmptyState>No recent events recorded for this zone.</EmptyState>
  }

  return (
    <>
      <div className="table-scroll">
        <table className="data-table row-clickable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Actors</th>
              <th className="num">Fatalities</th>
              <th className="num">Feeds model</th>
              <th aria-label="Details" />
            </tr>
          </thead>
          <tbody>
            {enriched.map((event, index) => (
              <tr
                key={event.event_id ?? `${event.event_date}-${index}`}
                tabIndex={0}
                onClick={() => setSelected(event)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelected(event)
                }}
              >
                <td>{fmtDate(event.event_date)}</td>
                <td>{event.event_type}</td>
                <td className="muted">
                  {[event.actor1, event.actor2].filter(Boolean).join(' vs ') || '—'}
                </td>
                <td className="num">{event.fatalities}</td>
                <td className="num">
                  {event.inWindow ? (
                    <StatusChip tone="info">
                      {event.windowShare != null
                        ? `${Math.round(event.windowShare * 100)}% of 90d`
                        : 'in window'}
                    </StatusChip>
                  ) : (
                    <StatusChip tone="neutral">history only</StatusChip>
                  )}
                </td>
                <td className="row-chevron" aria-hidden="true">
                  ›
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <EventDetailModal
          event={selected}
          zoneName={zoneName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  )
}

function EventDetailModal({
  event,
  zoneName,
  onClose,
}: {
  event: EventWithContribution
  zoneName?: string | null
  onClose: () => void
}) {
  return (
    <Modal
      eyebrow="Conflict event · observed (not forecast)"
      title={event.event_type}
      onClose={onClose}
      wide
    >
      <div className="detail-chips">
        <StatusChip tone={event.fatalities > 0 ? 'error' : 'neutral'}>
          {event.fatalities} fatalities
        </StatusChip>
        {event.inWindow ? (
          <StatusChip tone="info">inside 90-day feature window</StatusChip>
        ) : (
          <StatusChip tone="neutral">historical context only</StatusChip>
        )}
      </div>

      {EVENT_TYPE_META[event.event_type] ? (
        <p className="detail-lede">{EVENT_TYPE_META[event.event_type]}</p>
      ) : null}

      <div className="detail-grid">
        <DetailRow label="Zone">{zoneName ?? '—'}</DetailRow>
        <DetailRow label="Event date">{fmtDate(event.event_date)}</DetailRow>
        <DetailRow label="Primary actor">{event.actor1 ?? '—'}</DetailRow>
        <DetailRow label="Secondary actor">{event.actor2 ?? '—'}</DetailRow>
        <DetailRow label="Data source">{event.source ?? 'ACLED'}</DetailRow>
        <DetailRow label="Available to system">
          {fmtDateTime(event.available_at)}
        </DetailRow>
        <DetailRow label="Recency">
          {event.recencyDays === 0
            ? 'Most recent event'
            : `${event.recencyDays} days before the latest event`}
        </DetailRow>
      </div>

      {event.notes ? (
        <div className="detail-section">
          <h3>Notes</h3>
          <p className="detail-body">{event.notes}</p>
        </div>
      ) : null}

      <div className="detail-section detail-note">
        <h3>How this feeds the zone’s risk</h3>
        <p>
          Observed events enter the model through the incident-count features
          (this 10-day period, previous 10-day period), the incident <em>trend</em>, and the
          neighbouring-zone mean.{' '}
          {event.inWindow ? (
            <>
              This event sits inside the trailing 90-day window
              {event.windowShare != null
                ? ` and represents ~${Math.round(event.windowShare * 100)}% of the window's recorded events`
                : ''}
              , so it directly raises those features on the next assessment
              cycle.
            </>
          ) : (
            <>
              This event lies outside the trailing feature window and shapes the
              zone’s longer-term history rather than the current forecast.
            </>
          )}{' '}
          No single event deterministically sets the forecast — the model reads
          the pattern, and its reliance on each feature is shown in the
          what pushed the score in the situation view.
        </p>
      </div>
    </Modal>
  )
}
