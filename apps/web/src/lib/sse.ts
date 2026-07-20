/** SSE relay -> TanStack Query cache patch. The server is the single source of truth; SSE
 * only patches/invalidates the cache (never a parallel store). Backup polling covers drops. */
import type { QueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { API_BASE_URL } from './api'
import type { Delivery, DiraEvent, DeliveryStatus } from './types'

/** Pure: apply a delivery event to a deliveries list. Exported for tests. */
export function patchDeliveries(list: Delivery[], event: DiraEvent): Delivery[] {
  if (event.type !== 'delivery' || event.status === undefined) return list
  const status = event.status as DeliveryStatus
  return list.map((d) => (d.id === event.id ? { ...d, status } : d))
}

/** Apply a relayed event: patch deliveries caches in place; invalidate the map (recolor). */
export function applyDiraEvent(qc: QueryClient, event: DiraEvent): void {
  if (event.type === 'delivery') {
    qc.setQueriesData<Delivery[]>({ queryKey: ['deliveries'] }, (old) =>
      old ? patchDeliveries(old, event) : old,
    )
  }
  // Any event can change the map (new assessment band, or an ack turning a zone green).
  void qc.invalidateQueries({ queryKey: ['map'] })
}

/** Open the SSE stream and relay events into the query cache. Returns connection state.
 * EventSource auto-reconnects; on (re)connect we refetch everything to close any gap. */
export function useDiraStream(qc: QueryClient): boolean {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const es = new EventSource(`${API_BASE_URL}/events`)
    es.onopen = () => {
      setConnected(true)
      void qc.invalidateQueries() // refetch on (re)connect to cover missed notifies
    }
    es.onerror = () => setConnected(false) // browser retries automatically
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        applyDiraEvent(qc, JSON.parse(e.data) as DiraEvent)
      } catch {
        /* ignore malformed frames */
      }
    }
    return () => es.close()
  }, [qc])
  return connected
}
