import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { AskAdvisor } from '../features/advisor'
import { GuidedTour } from '../features/tour'
import { readTourProgress } from '../features/tour/tourSteps'
import { apiUrl, fetchMapSituations, fetchSources, queryKeys } from '../lib/api'
import { applySseEvent, parseDiraSseEvent } from '../lib/ssePatch'
import { useSelectedZone } from '../features/map/useSelectedZone'
import { ROUTE_TRANSITION } from '../lib/motion'
import { Sheet } from '../components/ui'
import { CommandBar } from './CommandBar'

/**
 * Owns the chrome that outlives any single route: the command bar, the one
 * SSE subscription for the whole app, the advisor sheet, and the tour.
 * `App.tsx` is now routing only.
 */
export function AppLayout() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const [sseFailed, setSseFailed] = useState(false)
  const [advisorOpen, setAdvisorOpen] = useState(false)
  // Selection lives in the URL now, so the advisor stays grounded in whatever
  // zone the map is showing without a parallel copy in the store.
  const { selectedSituationId } = useSelectedZone()

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
        onToggleAdvisor={() => setAdvisorOpen((value) => !value)}
        onOpenTour={() => {
          setTourStart(tourResumable ? (progress?.lastIndex ?? 0) : 0)
          setTourOpen(true)
        }}
        tourResumable={tourResumable}
      />

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
        onClose={() => setAdvisorOpen(false)}
        title="Ask Dira"
        subtitle="Grounded and read-only — it can never approve or dispatch."
      >
        <AskAdvisor situationId={selectedSituationId} />
      </Sheet>

      {tourOpen ? (
        <GuidedTour startAt={tourStart} onClose={() => setTourOpen(false)} />
      ) : null}
    </div>
  )
}
