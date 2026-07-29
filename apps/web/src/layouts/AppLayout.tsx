import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { AskAdvisor, useAdvisorStore } from '../features/advisor'
import { GuidedTour } from '../features/tour'
import { readTourProgress } from '../features/tour/tourSteps'
import { apiUrl, fetchMapSituations, fetchSources, fetchZones, queryKeys } from '../lib/api'
import { applySseEvent, parseDiraSseEvent } from '../lib/ssePatch'
import { useSelectedZone } from '../features/map/useSelectedZone'
import { ROUTE_TRANSITION } from '../lib/motion'
import { Sheet } from '../components/ui'
import { CommandBar } from './CommandBar'
import { PRIMARY_NAV, SECONDARY_NAV } from './navItems'
import { PressureRibbon } from './PressureRibbon'

/**
 * Owns the chrome that outlives any single route: the command bar, the one
 * SSE subscription for the whole app, the advisor sheet, and the tour.
 * `App.tsx` is now routing only.
 */
export function AppLayout() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [sseFailed, setSseFailed] = useState(false)
  /*
   * The advisor's open state lives in its store, not here, so any card
   * anywhere in the app can open it already asking a specific question
   * (see AskAboutButton) without threading a callback down the tree.
   */
  const advisorOpen = useAdvisorStore((state) => state.open)
  const toggleAdvisor = useAdvisorStore((state) => state.toggleAdvisor)
  const closeAdvisor = useAdvisorStore((state) => state.closeAdvisor)
  // Selection lives in the URL now, so the advisor stays grounded in whatever
  // zone the map is showing without a parallel copy in the store.
  const { selectedZoneId, selectedSituationId } = useSelectedZone()

  /*
   * The tour auto-opens only on a genuine first visit. If it was abandoned
   * part-way, the Guide button carries a dot and resumes where it stopped;
   * ?tour=1 forces it open for demos.
   */
  const [progress] = useState(() => readTourProgress())
  const forcedByUrl = new URLSearchParams(location.search).get('tour') === '1'
  const [tourOpen, setTourOpen] = useState(() => forcedByUrl || progress == null)
  const [tourStart, setTourStart] = useState(() => progress?.lastIndex ?? 0)
  const tourResumable = progress != null && !progress.completed && progress.lastIndex > 0

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
  // Shared with the map route via the query cache, so opening the advisor from
  // a non-map screen still knows which zone it is grounded in.
  const zonesQuery = useQuery({
    queryKey: queryKeys.zones,
    queryFn: fetchZones,
    staleTime: 60_000,
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

  /*
   * `G` then a letter jumps between screens, and `?` opens the guide. A
   * discoverable keyboard map is the cheapest signal that this is an
   * instrument rather than a website; the hints live in each nav item's title.
   *
   * The pending `G` lives in a ref because it is a transient input mode, not
   * rendered state — putting it in useState would re-render the whole layout
   * on every keystroke.
   */
  const chordRef = useRef<{ key: string; at: number } | null>(null)
  useEffect(() => {
    const routes = [...PRIMARY_NAV, ...SECONDARY_NAV]

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Never steal a keystroke from a field the user is typing into.
      if (
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        return
      }

      if (event.key === '?') {
        chordRef.current = null
        setTourStart(0)
        setTourOpen(true)
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'g') {
        chordRef.current = { key, at: Date.now() }
        return
      }

      const pending = chordRef.current
      chordRef.current = null
      // 1.2s is long enough to be forgiving and short enough that a stray `g`
      // does not hijack an unrelated keypress a minute later.
      if (!pending || Date.now() - pending.at > 1200) return

      const match = routes.find((route) => route.key === key)
      if (match) {
        event.preventDefault()
        navigate(match.to)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  const latestCycle = useMemo(() => {
    const cycles = (mapQuery.data?.features ?? [])
      .map((feature) => feature.properties.cycle)
      .filter((cycle): cycle is string => cycle != null)
    return cycles.sort().at(-1) ?? null
  }, [mapQuery.data?.features])

  const isMapRoute = location.pathname === '/'

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <CommandBar
        cycle={latestCycle}
        dataMode={sourcesQuery.data?.data_mode ?? null}
        degraded={sseFailed}
        advisorOpen={advisorOpen}
        onToggleAdvisor={toggleAdvisor}
        onOpenTour={() => {
          setTourStart(tourResumable ? (progress?.lastIndex ?? 0) : 0)
          setTourOpen(true)
        }}
        tourResumable={tourResumable}
      />
      <PressureRibbon />

      <main
        className={
          isMapRoute
            ? 'relative min-h-0 flex-1 overflow-hidden'
            : 'relative min-h-0 flex-1 overflow-y-auto'
        }
      >
        {/*
          The map must never remount on navigation — it would tear down the
          MapLibre instance and refetch tiles — so it opts out of the route
          transition entirely.
        */}
        {isMapRoute ? (
          <Outlet context={{ sseFailed }} />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} {...ROUTE_TRANSITION}>
              <Outlet context={{ sseFailed }} />
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      <Sheet
        open={advisorOpen}
        onClose={closeAdvisor}
        title="Ask Dira"
        subtitle="Grounded and read-only — it can never approve or dispatch."
        width="30rem"
      >
        <AskAdvisor
          situationId={selectedSituationId}
          zone={
            zonesQuery.data?.find((zone) => zone.zone_id === selectedZoneId) ?? null
          }
        />
      </Sheet>

      {tourOpen ? (
        <GuidedTour startAt={tourStart} onClose={() => setTourOpen(false)} />
      ) : null}
    </div>
  )
}
