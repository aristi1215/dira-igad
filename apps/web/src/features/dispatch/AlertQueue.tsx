import { fmtDateTime } from '../../lib/format'
import { cx } from '../../lib/cx'
import type { Alert } from '../../lib/types'

/**
 * Every alert waiting at the gate, not just the first one.
 *
 * The console used to render `pendingAlerts[0]` and summarise the rest as the
 * dead text "3 more waiting" — so the alert you had just drafted on the map
 * was not necessarily the one under the send button.
 */
export function AlertQueue({
  alerts,
  selectedId,
  onSelect,
}: {
  alerts: Alert[]
  selectedId: string | null
  onSelect: (alertId: string) => void
}) {
  if (alerts.length < 2) return null

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      <p className="text-eyebrow text-faint uppercase">
        {alerts.length} waiting on you
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {alerts.map((alert) => {
          const active = alert.id === selectedId
          return (
            <li key={alert.id}>
              <button
                type="button"
                aria-current={active}
                onClick={() => onSelect(alert.id)}
                className={cx(
                  'flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors',
                  active
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <span className="max-w-[12rem] truncate text-xs font-medium text-ink">
                  {alert.zone_name ?? 'Voice alert'}
                </span>
                <span className="text-2xs text-faint">
                  {alert.language.toUpperCase()} · {fmtDateTime(alert.created_at)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
