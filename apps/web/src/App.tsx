import './App.css'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
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

  const pendingCount = alertsQuery.data?.length ?? 0

  return (
    <div className="app-shell">
      <MapView
        situations={mapQuery.data}
        ackBySituation={ackQuery.data}
        isLoading={mapQuery.isLoading}
        cycle={latestCycle}
        sseFailed={sseFailed}
      />

      {mapQuery.isError ? (
        <p className="error-note app-error">
          Map situations are unavailable: {mapQuery.error.message}
        </p>
      ) : null}

      <LeftDock>
        {(tab) =>
          tab === 'watchlist' ? (
            <ZoneQueue
              situations={mapQuery.data}
              isLoading={mapQuery.isLoading}
            />
          ) : (
            <EconomyPanel
              focusCountry={selectedFeature?.properties.country_iso2 ?? null}
            />
          )
        }
      </LeftDock>

      <aside className="right-dock" aria-label="Situation controls">
        <Section title="Situation" badge={selectedFeature?.properties.zone_name ?? null} defaultOpen>
          <TabiriCard feature={selectedFeature} />
        </Section>
        <Section title="Field signals">
          <SignalsList zoneId={selectedZoneId} />
        </Section>
        <Section
          title="Approval gate"
          badge={pendingCount > 0 ? `${pendingCount} pending` : null}
          defaultOpen={pendingCount > 0}
        >
          <AdvisorPanel
            alerts={alertsQuery.data}
            isLoading={alertsQuery.isLoading}
            error={alertsQuery.error}
          />
        </Section>
        <Section title="Deliveries">
          <DispatchPanel
            deliveries={deliveriesQuery.data}
            isLoading={deliveriesQuery.isLoading}
            error={deliveriesQuery.error}
          />
        </Section>
        <Section title="Ask Dira">
          <AskAdvisor situationId={selectedSituationId} />
        </Section>
      </aside>
    </div>
  )
}

type LeftTab = 'watchlist' | 'economy'

function LeftDock({ children }: { children: (tab: LeftTab) => ReactNode }) {
  const [tab, setTab] = useState<LeftTab>('watchlist')
  const [open, setOpen] = useState(true)

  return (
    <aside className={open ? 'left-dock' : 'left-dock collapsed'}>
      <div className="dock-tabs">
        <button
          type="button"
          className={tab === 'watchlist' && open ? 'dock-tab active' : 'dock-tab'}
          onClick={() => {
            setTab('watchlist')
            setOpen(true)
          }}
        >
          Watchlist
        </button>
        <button
          type="button"
          className={tab === 'economy' && open ? 'dock-tab active' : 'dock-tab'}
          onClick={() => {
            setTab('economy')
            setOpen(true)
          }}
        >
          Economy
        </button>
        <button
          type="button"
          className="dock-toggle"
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '‹' : '›'}
        </button>
      </div>
      {open ? <div className="dock-body">{children(tab)}</div> : null}
    </aside>
  )
}

function Section({
  title,
  badge = null,
  defaultOpen = false,
  children,
}: {
  title: string
  badge?: string | null
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  const open = openOverride ?? defaultOpen

  return (
    <section className={open ? 'dock-section open' : 'dock-section'}>
      <button
        type="button"
        className="dock-section-head"
        aria-expanded={open}
        onClick={() => setOpenOverride(!open)}
      >
        <span>{title}</span>
        {badge ? <span className="dock-badge">{badge}</span> : null}
        <span className="dock-chevron">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="dock-section-body">{children}</div> : null}
    </section>
  )
}

export default App
