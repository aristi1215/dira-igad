import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map } from 'maplibre-gl'
import { TriangleAlert } from 'lucide-react'
import { hazardMeta, HAZARD_ICONS, HAZARD_SEVERITY_META } from '../../lib/explain'
import type { HazardCollection, HazardFeature, HazardProperties } from '../../lib/types'
import { cx } from '../../lib/cx'
import { spreadCoincident } from './geometry'
import { HazardCard } from './HazardCard'

type HazardPinsProps = {
  map: Map | null
  hazards: HazardCollection | undefined
  visible: boolean
}

/** Ring colour by how urgent the bulletin is. Full literal class names. */
const SEVERITY_RING: Record<string, string> = {
  advisory: 'border-line-strong',
  watch: 'border-warn-fg',
  warning: 'border-err-fg',
}

/**
 * Hazard bulletins as points on the map.
 *
 * Deliberately icon-only. These pins carried their hazard label inline at
 * first, which made each one ~140px wide — far wider than the ring offset that
 * separates coincident points, and wide enough to lie across the situation
 * badges and cut their scores in half. The label moved to hover and to the
 * card; at 28px the pins declutter properly and stay ambient context rather
 * than competing with the situations, which are the actual subject of the map.
 */
export function HazardPins({ map, hazards, visible }: HazardPinsProps) {
  const nodesRef = useRef(new globalThis.Map<string, HTMLDivElement>())
  const [selected, setSelected] = useState<{
    hazard: HazardProperties
    point: { x: number; y: number }
  } | null>(null)
  const [moveendTick, setMoveendTick] = useState(0)
  const entries = useMemo(() => hazards?.features ?? [], [hazards])

  /*
   * Positions are written straight to the DOM inside a rAF-coalesced `move`
   * handler, the same way SituationBadges does it — routing them through React
   * state would re-render every pin on every frame of a pan.
   */
  useEffect(() => {
    if (!map || !visible) return
    let frame = 0

    const reposition = () => {
      frame = 0
      const projected = spreadCoincident(
        entries.map((entry) => {
          const [lon, lat] = entry.geometry.coordinates
          const point = map.project([lon, lat])
          return [point.x, point.y] as [number, number]
        }),
        20,
      )
      entries.forEach((entry, index) => {
        const node = nodesRef.current.get(entry.properties.id)
        const point = projected[index]
        if (!node || !point) return
        node.style.transform = `translate3d(${point[0]}px, ${point[1]}px, 0)`
      })
    }

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(reposition)
    }

    const handleMoveEnd = () => {
      reposition()
      setMoveendTick((tick) => tick + 1)
    }

    reposition()
    map.on('move', schedule)
    map.on('moveend', handleMoveEnd)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      map.off('move', schedule)
      map.off('moveend', handleMoveEnd)
    }
  }, [entries, map, moveendTick, visible])

  if (!map || !visible) return null

  return (
    <>
      {/*
        z-map-base, not z-map-ui: hazards sit above the canvas but beneath the
        situation badges, which are the map's primary read.
      */}
      <div className="pointer-events-none absolute inset-0 z-map-base overflow-hidden">
        {entries.map((entry) => (
          <HazardPin
            key={entry.properties.id}
            entry={entry}
            register={(node) => {
              if (node) nodesRef.current.set(entry.properties.id, node)
              else nodesRef.current.delete(entry.properties.id)
            }}
            onSelect={(hazard, point) => setSelected({ hazard, point })}
          />
        ))}
      </div>
      {selected ? (
        <HazardCard
          hazard={selected.hazard}
          point={selected.point}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  )
}

function HazardPin({
  entry,
  register,
  onSelect,
}: {
  entry: HazardFeature
  register: (node: HTMLDivElement | null) => void
  onSelect: (hazard: HazardProperties, point: { x: number; y: number }) => void
}) {
  const meta = hazardMeta(entry.properties.hazard_type)
  const severity = HAZARD_SEVERITY_META[entry.properties.severity]
  const Icon = HAZARD_ICONS[entry.properties.hazard_type] ?? TriangleAlert
  const label = `${meta.label} · ${severity?.label ?? entry.properties.severity}`

  return (
    /*
     * Two elements: the outer one owns the projected position (an inline
     * `transform` would otherwise wipe the centring utilities), the inner one
     * centres the pin on that point.
     */
    <div ref={register} className="absolute top-0 left-0 will-change-transform">
      <div className="group absolute -translate-x-1/2 -translate-y-1/2">
        {entry.properties.severity === 'warning' ? (
          <span
            aria-hidden
            className="absolute inset-0 -z-1 animate-signal-pulse rounded-full bg-err-fg"
          />
        ) : null}
        <button
          type="button"
          aria-label={`${label} in ${entry.properties.zone_name}`}
          className={cx(
            'pointer-events-auto grid size-5 place-items-center rounded-full border bg-surface shadow-md',
            'transition-transform duration-150 ease-standard hover:scale-110',
            SEVERITY_RING[entry.properties.severity] ?? 'border-line-strong',
          )}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onSelect(entry.properties, {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            })
          }}
        >
          <Icon size={11} strokeWidth={2} aria-hidden style={{ color: meta.color }} />
        </button>

        {/* Label on hover only, so 22 bulletins do not paper over the map. */}
        <span
          aria-hidden
          className={cx(
            'pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-full',
            'border border-line bg-surface/95 px-2 py-0.5 text-2xs font-medium whitespace-nowrap text-ink shadow-panel',
            'opacity-0 transition-opacity duration-150 ease-standard group-hover:opacity-100',
          )}
        >
          {label}
        </span>
      </div>
    </div>
  )
}
