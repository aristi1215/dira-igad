import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import { queryKeys } from '../../lib/api'
import { preloadScreens } from '../../routes/preload'
import { anchorSelector } from './tourAnchors'
import { TOUR_STEPS, writeTourProgress, type TourContext } from './tourSteps'
import { waitForAnchor } from './waitForAnchor'
import { useAnchorRect } from './useAnchorRect'
import { Blockers, Spotlight } from './Spotlight'
import { CoachMark } from './CoachMark'
import type { SituationFeatureCollection, ZoneSummary } from '../../lib/types'

export function GuidedTour({
  startAt = 0,
  onClose,
}: {
  startAt?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(startAt)
  /*
   * Which step has finished navigating and settled. Storing the step id rather
   * than a boolean means readiness resets implicitly when the step changes, so
   * the effect never has to setState synchronously to clear it.
   */
  const [readyStepId, setReadyStepId] = useState<string | null>(null)
  const navigate = useNavigate()
  const [, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion() ?? false
  const runIdRef = useRef(0)

  const step = TOUR_STEPS[index]
  const total = TOUR_STEPS.length

  /**
   * The highest-risk zone with an open situation, so the evidence steps have
   * something real to point at.
   *
   * Read imperatively inside the step effect rather than in a useMemo: the
   * memo body would not reference `index`, so the React Compiler is free to
   * treat it as depending on `queryClient` alone and cache the very first
   * (empty) result forever. An effect gets a fresh read on every step.
   *
   * Map situations are preferred over the zones list because AppLayout fetches
   * them itself, so they are present on every route — the zones list is only
   * fetched by the map screen.
   */
  const resolveContext = useCallback((): TourContext => {
    const situations =
      queryClient.getQueryData<SituationFeatureCollection>(queryKeys.mapSituations)?.features ?? []
    const topSituation = situations
      .map((feature) => feature.properties)
      .filter((properties) => properties.situation_status === 'open')
      .sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1))[0]

    if (topSituation) {
      return {
        topZoneId: topSituation.zone_id,
        topSituationId: topSituation.situation_id,
      }
    }

    const zones = queryClient.getQueryData<ZoneSummary[]>(queryKeys.zones) ?? []
    const topZone = [...zones].sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1))[0]
    return {
      topZoneId: topZone?.zone_id ?? null,
      topSituationId: topZone?.situation_id ?? null,
    }
  }, [queryClient])

  useEffect(() => {
    preloadScreens()
  }, [])

  // Drive the app to the state this step describes, then wait for its anchor.
  useEffect(() => {
    const runId = ++runIdRef.current
    let cancelled = false

    const run = async () => {
      const context = resolveContext()
      const route = step.resolveRoute ? step.resolveRoute(context) : step.route
      const selectedZone = step.precondition?.(context) ?? null

      if (route && window.location.pathname !== route.split('?')[0]) {
        navigate(route)
      }

      if (selectedZone) {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current)
            next.set('zone', selectedZone)
            return next
          },
          { replace: true },
        )
      }

      const element = await waitForAnchor(anchorSelector(step.anchor), 2500)
      if (cancelled || runId !== runIdRef.current) return

      if (element) {
        element.scrollIntoView({
          block: 'center',
          behavior: reduceMotion ? 'auto' : 'smooth',
        })
        // Let the smooth scroll land before the spotlight measures.
        await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : 320))
      }
      if (cancelled || runId !== runIdRef.current) return
      setReadyStepId(step.id)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [navigate, reduceMotion, resolveContext, setSearchParams, step])

  const rect = useAnchorRect(anchorSelector(step.anchor), readyStepId === step.id)

  const finish = useCallback(
    (completed: boolean) => {
      writeTourProgress({ completed, lastIndex: completed ? 0 : index })
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('tour')
          return next
        },
        { replace: true },
      )
      onClose()
    },
    [index, onClose, setSearchParams],
  )

  const goNext = useCallback(() => {
    if (index >= total - 1) {
      finish(true)
      return
    }
    const next = index + 1
    writeTourProgress({ completed: false, lastIndex: next })
    setIndex(next)
  }, [finish, index, total])

  const goBack = useCallback(() => setIndex((current) => Math.max(0, current - 1)), [])

  // Arrow keys move through the tour; Escape is handled by the coach mark's trap.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goBack, goNext])

  return createPortal(
    <AnimatePresence>
      <Spotlight key="spotlight" rect={rect} reduceMotion={reduceMotion} />
      {/* Interactive steps skip the blockers so the real control stays clickable. */}
      {step.interactive ? null : (
        <Blockers key="blockers" rect={rect} onClick={() => {}} />
      )}
      <CoachMark
        key="coach"
        step={step}
        index={index}
        total={total}
        rect={rect}
        reduceMotion={reduceMotion}
        onNext={goNext}
        onBack={goBack}
        onSkip={() => finish(false)}
        onJump={(target) => setIndex(target)}
      />
    </AnimatePresence>,
    document.body,
  )
}
