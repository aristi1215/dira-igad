import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

const ALERT_PARAM = 'alert'

/**
 * Which alert the console is working on, kept in the URL (`/dispatch?alert=…`).
 *
 * The screen used to hard-wire itself to `pendingAlerts[0]`, so drafting an
 * alert on the map and landing here could put you in front of a different one
 * — with the send button right there. Naming it in the URL means the map can
 * hand over the alert it just drafted, and a reload keeps you on it.
 *
 * `replace: true` for the same reason as the map's zone parameter: stepping
 * through a queue of five alerts should not leave five history entries behind.
 */
export function useSelectedAlert() {
  const [searchParams, setSearchParams] = useSearchParams()

  const requestedAlertId = searchParams.get(ALERT_PARAM)

  const selectAlert = useCallback(
    (alertId: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (alertId) {
            next.set(ALERT_PARAM, alertId)
          } else {
            next.delete(ALERT_PARAM)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { requestedAlertId, selectAlert }
}
