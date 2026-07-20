import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AdvisorPanel } from './features/advisor'
import { DispatchPanel } from './features/dispatch'
import { MapView } from './features/map'
import { TabiriCard } from './features/situations'
import {
  apiUrl,
  fetchDeliveries,
  fetchMapSituations,
  fetchPendingAlerts,
  queryKeys,
} from './lib/api'
import { applySseEvent, parseDiraSseEvent } from './lib/ssePatch'
import type { AckBySituation } from './lib/types'
import { useMapUiStore } from './stores/mapUi'

function App() {
  const queryClient = useQueryClient()
  const [sseFailed, setSseFailed] = useState(false)
  const selectedSituationId = useMapUiStore((state) => state.selectedSituationId)
  const fallbackInterval = sseFailed ? 3_000 : false

  const mapQuery = useQuery({
    queryKey: queryKeys.mapSituations,
    queryFn: fetchMapSituations,
    refetchInterval: fallbackInterval,
  })
  const alertsQuery = useQuery({
    queryKey: queryKeys.pendingAlerts,
    queryFn: fetchPendingAlerts,
    refetchInterval: fallbackInterval,
    retry: 1,
  })
  const deliveriesQuery = useQuery({
    queryKey: queryKeys.deliveries,
    queryFn: fetchDeliveries,
    refetchInterval: fallbackInterval,
  })
  const ackQuery = useQuery<AckBySituation>({
    queryKey: queryKeys.ackBySituation,
    queryFn: () => Promise.resolve({}),
    enabled: false,
    initialData: {},
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    const events = new EventSource(apiUrl('/events'))

    const handleOpen = () => {
      setSseFailed(false)
    }
    const handleDira = (event: Event) => {
      const message = event as MessageEvent<string>
      try {
        const rawPayload: unknown = JSON.parse(message.data)
        const payload = parseDiraSseEvent(rawPayload)
        if (payload) {
          applySseEvent(queryClient, payload)
        }
      } catch (error) {
        console.warn('Unable to parse Dira SSE event', error)
      }
    }
    const handleError = () => {
      setSseFailed(true)
    }

    events.addEventListener('open', handleOpen)
    events.addEventListener('dira', handleDira)
    events.addEventListener('error', handleError)

    return () => {
      events.removeEventListener('open', handleOpen)
      events.removeEventListener('dira', handleDira)
      events.removeEventListener('error', handleError)
      events.close()
    }
  }, [queryClient])

  const selectedFeature = useMemo(
    () =>
      mapQuery.data?.features.find(
        (feature) => feature.properties.situation_id === selectedSituationId,
      ) ?? null,
    [mapQuery.data?.features, selectedSituationId],
  )

  return (
    <div className="app-shell">
      <header className="app-header panel-fade">
        <div>
          <p className="eyebrow">IGAD Husika Hackathon 2026</p>
          <h1>Dira</h1>
          <p>
            Causal situation room for Mandera and the wider Horn of Africa.
          </p>
        </div>
        <div className="header-status">
          <span className={sseFailed ? 'status-dot fallback' : 'status-dot'} />
          {sseFailed ? 'Polling backup every 3s' : 'SSE live'}
        </div>
      </header>

      {mapQuery.isError ? (
        <p className="error-note app-error">
          Map situations are unavailable: {mapQuery.error.message}
        </p>
      ) : null}

      <main className="situation-room">
        <MapView
          situations={mapQuery.data}
          ackBySituation={ackQuery.data}
          isLoading={mapQuery.isLoading}
        />
        <aside className="right-rail" aria-label="Situation controls">
          <TabiriCard feature={selectedFeature} />
          <AdvisorPanel
            alerts={alertsQuery.data}
            isLoading={alertsQuery.isLoading}
            error={alertsQuery.error}
          />
          <DispatchPanel
            deliveries={deliveriesQuery.data}
            isLoading={deliveriesQuery.isLoading}
            error={deliveriesQuery.error}
          />
        </aside>
      </main>
    </div>
  )
}

export default App
