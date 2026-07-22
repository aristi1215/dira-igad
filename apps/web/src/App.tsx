import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AdvisorPanel, AskAdvisor } from './features/advisor'
import { DispatchPanel } from './features/dispatch'
import { EconomyPanel } from './features/economy'
import { MapView } from './features/map'
import { ZoneQueue } from './features/queue'
import { SignalsList, TabiriCard } from './features/situations'
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
  const selectedZoneId = useMapUiStore((state) => state.selectedZoneId)
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

  const latestCycle = useMemo(() => {
    const cycles = (mapQuery.data?.features ?? [])
      .map((f) => f.properties.cycle)
      .filter((c): c is string => c != null)
    return cycles.sort().at(-1) ?? null
  }, [mapQuery.data?.features])

  return (
    <div className="app-shell">
      <header className="app-header panel-fade">
        <div className="header-brand">
          <h1>DIRA</h1>
          <div>
            <p className="header-title">IGAD Conflict Early Warning &amp; Response</p>
            <p className="header-sub">
              Climate-driven conflict pressure · Horn of Africa situation room
            </p>
          </div>
        </div>
        <div className="header-meta">
          {latestCycle ? (
            <span className="cycle-chip">Cycle {latestCycle}</span>
          ) : null}
          <div className="header-status">
            <span className={sseFailed ? 'status-dot fallback' : 'status-dot'} />
            {sseFailed ? 'Polling backup every 3s' : 'SSE live'}
          </div>
        </div>
      </header>

      {mapQuery.isError ? (
        <p className="error-note app-error">
          Map situations are unavailable: {mapQuery.error.message}
        </p>
      ) : null}

      <main className="situation-room">
        <aside className="left-rail" aria-label="Watchlist and economy">
          <ZoneQueue situations={mapQuery.data} isLoading={mapQuery.isLoading} />
          <EconomyPanel
            focusCountry={selectedFeature?.properties.country_iso2 ?? null}
          />
        </aside>

        <MapView
          situations={mapQuery.data}
          ackBySituation={ackQuery.data}
          isLoading={mapQuery.isLoading}
        />

        <aside className="right-rail" aria-label="Situation controls">
          <TabiriCard feature={selectedFeature} />
          <SignalsList zoneId={selectedZoneId} />
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
          <AskAdvisor situationId={selectedSituationId} />
        </aside>
      </main>
    </div>
  )
}

export default App
