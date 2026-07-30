import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map } from 'maplibre-gl'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { BAND_COLORS, BAND_LABELS, fmtRiskScore } from '../../lib/format'
import type {
  AckBySituation,
  MapEvents,
  OperationalBand,
  RegionalIndicators,
  SituationFeatureCollection,
  ZoneTrends,
} from '../../lib/types'
import { Sparkline } from '../../components/ui'
import { cx } from '../../lib/cx'
import { eventWeightedAnchors, featureCenter } from './geometry'

/** Below this, badges collapse to pips — 22 cards at continental zoom is noise. */
const PIP_ONLY_ZOOM = 5.2

/** Approximate rendered badge box, used for collision only. */
const BADGE_W = 168
const BADGE_H = 46
/** Vertical gap between the anchor and the badge's bottom edge. */
const LEADER_LENGTH = 26

type Placed = {
  zoneId: string
  situationId: string | null
  zoneName: string
  band: OperationalBand
  risk: number
  acknowledged: boolean
  lngLat: [number, number]
  trend: number[]
  delta: number | null
  /** False when a higher-risk badge already occupies this space. */
  expanded: boolean
}

type SituationBadgesProps = {
  map: Map | null
  indicators: RegionalIndicators | undefined
  situations: SituationFeatureCollection | undefined
  events: MapEvents | undefined
  trends: ZoneTrends | undefined
  ackBySituation: AckBySituation
  selectedZoneId: string | null
  bandFilter: Set<OperationalBand> | null
  onSelect: (zoneId: string, situationId: string | null) => void
}

/**
 * The situation markers.
 *
 * These replaced a plain circle, which could only ever say "something is here"
 * — leaving the score, the direction of travel and the acknowledgement state
 * all behind a click. A badge carries them at a glance: band, score, six-dekad
 * trend and delta.
 *
 * They are HTML rather than a MapLibre symbol layer because a symbol layer
 * cannot draw a sparkline without pre-rendering an image per zone per cycle,
 * and because Tailwind and the band tokens then apply directly.
 */
export function SituationBadges({
  map,
  indicators,
  situations,
  events,
  trends,
  ackBySituation,
  selectedZoneId,
  bandFilter,
  onSelect,
}: SituationBadgesProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef(new globalThis.Map<string, HTMLDivElement>())
  /** Bumped on moveend so collision re-runs against the new projection. */
  const [placementTick, setPlacementTick] = useState(0)

  const anchors = useMemo(() => eventWeightedAnchors(events), [events])

  /** One entry per open situation, richest-first, before collision. */
  const candidates = useMemo<Omit<Placed, 'expanded'>[]>(() => {
    const zoneById = new globalThis.Map(
      (indicators?.features ?? []).map((feature) => [feature.properties.zone_id, feature]),
    )

    return (situations?.features ?? [])
      .flatMap((feature) => {
        const { zone_id: zoneId, situation_id: situationId } = feature.properties
        const zoneFeature = zoneById.get(zoneId)

        // Prefer the conflict-weighted anchor; fall back to the zone's bbox
        // centre, then to the situation geometry's own centre.
        const anchor =
          anchors.get(zoneId) ??
          (zoneFeature ? featureCenter(zoneFeature) : null) ??
          featureCenter(feature)
        if (!anchor) return []

        const band = (feature.properties.operational_band ?? 'low') as OperationalBand
        const history = (trends?.[zoneId] ?? []).map((point) => point.model_risk)
        const risk = feature.properties.model_risk ?? history.at(-1) ?? 0

        // Change since the previous cycle, in risk points. Null when there is
        // no earlier cycle — an unknown trend must not render as "flat".
        const previous = history.length >= 2 ? history[history.length - 2] : null
        const delta = previous == null ? null : (risk - previous) * 100

        return [
          {
            zoneId,
            situationId: situationId ?? null,
            zoneName: feature.properties.zone_name ?? zoneId,
            band,
            risk,
            acknowledged: ackBySituation[situationId] === 'acknowledged',
            lngLat: anchor,
            trend: history,
            delta,
          },
        ]
      })
      .filter((entry) => !bandFilter || bandFilter.has(entry.band))
      .sort((a, b) => b.risk - a.risk)
  }, [anchors, ackBySituation, bandFilter, indicators, situations, trends])

  /*
   * Collision, resolved once per camera rest rather than per frame.
   *
   * Greedy in descending risk, so when two badges fight for the same space the
   * more urgent one keeps its numbers and the quieter one degrades to a pip.
   * The selected zone is placed first unconditionally — the thing you just
   * clicked must never be the thing that gets suppressed.
   */
  const placed = useMemo<Placed[]>(() => {
    void placementTick // recompute when the camera settles
    if (!map) return []

    const zoom = map.getZoom()
    const taken: { x: number; y: number }[] = []

    const ordered = [...candidates].sort((a, b) => {
      if (a.zoneId === selectedZoneId) return -1
      if (b.zoneId === selectedZoneId) return 1
      return b.risk - a.risk
    })

    return ordered.map((candidate) => {
      if (zoom < PIP_ONLY_ZOOM && candidate.zoneId !== selectedZoneId) {
        return { ...candidate, expanded: false }
      }
      const point = map.project(candidate.lngLat)
      const clash = taken.some(
        (other) =>
          Math.abs(other.x - point.x) < BADGE_W && Math.abs(other.y - point.y) < BADGE_H * 1.6,
      )
      if (clash) {
        return { ...candidate, expanded: false }
      }
      taken.push({ x: point.x, y: point.y })
      return { ...candidate, expanded: true }
    })
  }, [candidates, map, placementTick, selectedZoneId])

  /*
   * Positioning.
   *
   * Transforms are written straight to the DOM inside the move handler and
   * coalesced with rAF. Routing 22 positions through React state would mean 22
   * component re-renders per animation frame while panning, which the React
   * Compiler cannot rescue — this is exactly the case where imperative is
   * correct.
   */
  useEffect(() => {
    if (!map) return
    let frame = 0

    const reposition = () => {
      frame = 0
      for (const entry of placed) {
        const node = nodesRef.current.get(entry.zoneId)
        if (!node) continue
        const point = map.project(entry.lngLat)
        node.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`
      }
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(reposition)
    }

    const handleMoveEnd = () => {
      reposition()
      setPlacementTick((tick) => tick + 1)
    }

    reposition()
    map.on('move', schedule)
    map.on('moveend', handleMoveEnd)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('move', schedule)
      map.off('moveend', handleMoveEnd)
    }
  }, [map, placed])

  if (!map) return null

  return (
    <div
      ref={layerRef}
      // The layer itself must never eat map drags; each badge opts back in.
      className="pointer-events-none absolute inset-0 z-map-ui overflow-hidden"
      aria-hidden
    >
      {placed.map((entry) => (
        <Badge
          key={entry.zoneId}
          entry={entry}
          selected={entry.zoneId === selectedZoneId}
          onSelect={onSelect}
          register={(node) => {
            if (node) nodesRef.current.set(entry.zoneId, node)
            else nodesRef.current.delete(entry.zoneId)
          }}
        />
      ))}
    </div>
  )
}

function Badge({
  entry,
  selected,
  onSelect,
  register,
}: {
  entry: Placed
  selected: boolean
  onSelect: (zoneId: string, situationId: string | null) => void
  register: (node: HTMLDivElement | null) => void
}) {
  const color = entry.acknowledged ? BAND_COLORS.ack : BAND_COLORS[entry.band]
  // Only unresolved, genuinely pressing situations pulse. Everything drawing
  // the eye means nothing does.
  const pulsing =
    !entry.acknowledged && (entry.band === 'high' || entry.band === 'very_high')

  return (
    <div
      ref={register}
      className="absolute top-0 left-0 will-change-transform"
      style={{ zIndex: selected ? 30 : Math.round(entry.risk * 20) }}
    >
      {/* The anchor sits at the projected point; everything else hangs off it. */}
      <span className="absolute -translate-x-1/2 -translate-y-1/2">
        {pulsing ? (
          <span
            className="absolute inset-0 -z-1 animate-signal-pulse rounded-full"
            style={{ background: color }}
          />
        ) : null}
        <span
          className="block size-2.5 rounded-full border-2 border-white"
          style={{ background: color, boxShadow: '0 0 0 1px rgba(22,22,22,0.18)' }}
        />
      </span>

      {entry.expanded ? (
        <>
          <span
            aria-hidden
            className="absolute w-px -translate-x-1/2 bg-line-strong"
            style={{ height: LEADER_LENGTH, bottom: 0, transform: 'translate(-50%, -5px)' }}
          />
          <button
            type="button"
            onClick={() => onSelect(entry.zoneId, entry.situationId)}
            aria-label={`${entry.zoneName} — ${BAND_LABELS[entry.band]}, risk ${fmtRiskScore(entry.risk)}`}
            className={cx(
              'pointer-events-auto absolute flex -translate-x-1/2 items-stretch overflow-hidden rounded-xl',
              'border border-line bg-surface/92 shadow-lg backdrop-blur-xl',
              'transition-[box-shadow,border-color] duration-[140ms] ease-standard',
              'hover:border-line-strong hover:shadow-lg',
              selected && 'border-ink ring-1 ring-ink',
            )}
            style={{ bottom: LEADER_LENGTH + 4, left: 0 }}
          >
            <span aria-hidden className="w-[2.5px] shrink-0 rounded-l-xl" style={{ background: color }} />
            <span className="flex flex-col gap-0.5 px-2 py-1.5 text-left">
              <span className="max-w-[9rem] truncate text-eyebrow leading-none text-faint uppercase">
                {entry.zoneName}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="font-mono text-lg leading-none font-semibold tabular-nums"
                  style={{ color }}
                >
                  {fmtRiskScore(entry.risk)}
                </span>
                <Sparkline
                  values={entry.trend}
                  width={30}
                  height={13}
                  color={color}
                  cap={false}
                />
                <Delta value={entry.delta} />
              </span>
            </span>
          </button>
        </>
      ) : null}
    </div>
  )
}

/**
 * Change in risk points since the previous cycle.
 *
 * Rising risk is always the bad direction here, so the color mapping is fixed
 * rather than configurable — there is no reading of this number where a climb
 * is good news.
 */
function Delta({ value }: { value: number | null }) {
  if (value == null || Math.abs(value) < 1) return null
  const rising = value > 0
  const Icon = rising ? TrendingUp : TrendingDown
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 font-mono text-2xs font-medium tabular-nums',
        rising ? 'text-err-fg' : 'text-ok-fg',
      )}
    >
      <Icon size={11} strokeWidth={2.25} aria-hidden />
      {Math.abs(Math.round(value))}
    </span>
  )
}
