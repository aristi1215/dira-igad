import { TOUR_ANCHORS, type TourAnchor } from './tourAnchors'
import type { Side } from '../../lib/anchor'

export type TourContext = {
  /** Zone id of the highest-risk zone, once the watchlist has loaded. */
  topZoneId: string | null
  /** Situation id for that zone, when one is open. */
  topSituationId: string | null
}

export type TourStep = {
  id: string
  /** Grouping label shown above the progress rail. */
  chapter: string
  anchor: TourAnchor
  title: string
  body: string
  /** Route to be on before measuring. Resolved lazily for :id routes. */
  route?: string
  resolveRoute?: (context: TourContext) => string | null
  /** Run before measuring — e.g. select a zone so the card exists. */
  precondition?: (context: TourContext) => string | null
  /** Let the user actually click the highlighted control during this step. */
  interactive?: boolean
  /** Preferred side for the coach mark. */
  side?: Side
}

/**
 * Nine steps, in the order a duty officer would actually meet them.
 *
 * The old "forecast window" slide is gone: that fact now lives permanently in
 * the zone card's caption, so it needs no lecture. Wording follows the tone of
 * ScoreFlow and BAND_GUIDANCE — plain, specific, no jargon.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    chapter: 'Orientation',
    anchor: TOUR_ANCHORS.brand,
    route: '/',
    side: 'bottom',
    title: 'This is Dira',
    body: 'It watches 22 zones across seven IGAD countries and forecasts where conflict pressure is building over the next 30 days or so.',
  },
  {
    id: 'map',
    chapter: 'Orientation',
    anchor: TOUR_ANCHORS.mapCanvas,
    route: '/',
    side: 'left',
    title: 'Colour is the forecast',
    body: 'Every zone is shaded — including the quiet ones. Darker means more pressure building.',
  },
  {
    id: 'overlays',
    chapter: 'Orientation',
    anchor: TOUR_ANCHORS.mapOverlays,
    route: '/',
    side: 'bottom',
    interactive: true,
    title: 'Change what the colour means',
    body: 'Switch between conflict pressure, food security, displacement, incidents and hazards. Go ahead and try one — the map stays put.',
  },
  {
    id: 'watchlist',
    chapter: 'Reading a zone',
    anchor: TOUR_ANCHORS.mapWatchlist,
    route: '/',
    side: 'right',
    title: 'Start at the top',
    body: 'Zones ranked by pressure and grouped by band. The line above tells you how many need attention right now, and how many people live there.',
  },
  {
    id: 'zone-card',
    chapter: 'Reading a zone',
    anchor: TOUR_ANCHORS.mapZoneCard,
    route: '/',
    side: 'left',
    precondition: (context) => context.topZoneId,
    title: 'What to do, then how much',
    body: 'The sentence at the top tells you what this band means for action. The number tells you how strong the signal is, with the band thresholds marked on the bar.',
  },
  {
    id: 'two-score',
    chapter: 'Evidence',
    anchor: TOUR_ANCHORS.twoScore,
    resolveRoute: (context) =>
      context.topSituationId ? `/situations/${context.topSituationId}` : null,
    side: 'right',
    title: 'Two scores, never blended',
    body: 'The model forecast comes from climate and conflict history alone. Corroboration is what people and media are reporting right now. The exact rule that combines them is written on every assessment.',
  },
  {
    id: 'drivers',
    chapter: 'Evidence',
    anchor: TOUR_ANCHORS.shapDrivers,
    resolveRoute: (context) =>
      context.topSituationId ? `/situations/${context.topSituationId}` : null,
    side: 'top',
    title: 'What the model leaned on',
    body: 'Each bar is one input pushing the score up or down this cycle. Select any of them for what it means in plain language.',
  },
  {
    id: 'approval',
    chapter: 'Acting',
    anchor: TOUR_ANCHORS.approvalGate,
    route: '/dispatch',
    side: 'top',
    title: 'Alerts never send themselves',
    body: 'A named person reads the message and approves it. Only then are the calls queued — the database itself refuses anything else.',
  },
  {
    id: 'advisor',
    chapter: 'Acting',
    anchor: TOUR_ANCHORS.askDira,
    route: '/dispatch',
    side: 'bottom',
    title: 'Ask about any zone',
    body: 'The advisor answers from this zone’s own situation, signals, hazards and field reports, and cites what it used. It can never approve or dispatch anything.',
  },
]

export const TOUR_STORAGE_KEY = 'dira-tour-v2'

export type TourProgress = {
  v: number
  completed: boolean
  lastIndex: number
  ts: number
}

export function readTourProgress(): TourProgress | null {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TourProgress
    return parsed && typeof parsed.lastIndex === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function writeTourProgress(progress: Omit<TourProgress, 'v' | 'ts'>): void {
  try {
    localStorage.setItem(
      TOUR_STORAGE_KEY,
      JSON.stringify({ v: 2, ts: Date.now(), ...progress } satisfies TourProgress),
    )
  } catch {
    // Storage can be unavailable (private mode); the tour still works.
  }
}
