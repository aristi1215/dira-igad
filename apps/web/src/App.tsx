import './App.css'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AskAdvisor } from './features/advisor'
import {
  apiUrl,
  fetchMapSituations,
  fetchSources,
  queryKeys,
} from './lib/api'
import { applySseEvent, parseDiraSseEvent } from './lib/ssePatch'
import { useMapUiStore } from './stores/mapUi'
import { MapScreen } from './screens/MapScreen'
import { SituationsScreen } from './screens/SituationsScreen'
import { SituationDetailScreen } from './screens/SituationDetailScreen'
import { ZonesScreen } from './screens/ZonesScreen'
import { ZoneDossierScreen } from './screens/ZoneDossierScreen'
import { DispatchScreen } from './screens/DispatchScreen'
import { AnalyticsScreen } from './screens/AnalyticsScreen'
import { SourcesScreen } from './screens/SourcesScreen'

const NAV_ITEMS = [
  { to: '/', label: 'Map', end: true },
  { to: '/situations', label: 'Situations', end: false },
  { to: '/zones', label: 'Zones', end: false },
  { to: '/dispatch', label: 'Dispatch', end: false },
  { to: '/analytics', label: 'Analytics', end: false },
  { to: '/sources', label: 'Sources', end: false },
]

function App() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [sseFailed, setSseFailed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const selectedSituationId = useMapUiStore((state) => state.selectedSituationId)

  const mapQuery = useQuery({
    queryKey: queryKeys.mapSituations,
    queryFn: fetchMapSituations,
    refetchInterval: sseFailed ? 5_000 : false,
  })
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: fetchSources,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })

  // One SSE subscription for the whole app: Postgres LISTEN/NOTIFY → /events
  // → targeted TanStack Query invalidations (see lib/ssePatch.ts).
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

  const latestCycle = useMemo(() => {
    const cycles = (mapQuery.data?.features ?? [])
      .map((f) => f.properties.cycle)
      .filter((c): c is string => c != null)
    return cycles.sort().at(-1) ?? null
  }, [mapQuery.data?.features])

  const dataMode = sourcesQuery.data?.data_mode ?? null
  const isMapRoute = location.pathname === '/'

  return (
    <div className="app-shell">
      <header className="command-bar">
        <div className="brand">
          <span className="brand-word">DIRA</span>
          <span className="brand-sub">Early-warning situation room · IGAD</span>
        </div>
        <nav className="app-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="command-bar-right">
          {latestCycle ? <span className="cycle-chip">Cycle {latestCycle}</span> : null}
          {dataMode ? (
            <span className={dataMode === 'live' ? 'mode-chip live' : 'mode-chip'}>
              {dataMode.toUpperCase()}
            </span>
          ) : null}
          <span className="header-status">
            <span className={sseFailed ? 'status-dot fallback' : 'status-dot'} />
            {sseFailed ? 'Polling' : 'Live'}
          </span>
          <button
            type="button"
            className={drawerOpen ? 'drawer-toggle open' : 'drawer-toggle'}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((value) => !value)}
          >
            Ask Dira
          </button>
        </div>
      </header>

      <main className={isMapRoute ? 'app-main flush' : 'app-main'}>
        <Routes>
          <Route path="/" element={<MapScreen sseFailed={sseFailed} />} />
          <Route path="/situations" element={<SituationsScreen />} />
          <Route path="/situations/:id" element={<SituationDetailScreen />} />
          <Route path="/zones" element={<ZonesScreen />} />
          <Route path="/zones/:id" element={<ZoneDossierScreen />} />
          <Route path="/dispatch" element={<DispatchScreen />} />
          <Route path="/analytics" element={<AnalyticsScreen />} />
          <Route path="/sources" element={<SourcesScreen />} />
        </Routes>

        {drawerOpen ? (
          <aside className="advisor-drawer" aria-label="Ask Dira advisor">
            <AskAdvisor situationId={selectedSituationId} />
          </aside>
        ) : null}
      </main>
    </div>
  )
}

export default App
