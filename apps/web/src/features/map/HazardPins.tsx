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

export function HazardPins({ map, hazards, visible }: HazardPinsProps) {
  const nodesRef = useRef(new globalThis.Map<string, HTMLButtonElement>())
  const [selected, setSelected] = useState<{ hazard: HazardProperties; point: { x: number; y: number } } | null>(null)
  const [moveendTick, setMoveendTick] = useState(0)
  const entries = useMemo(() => hazards?.features ?? [], [hazards])

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
        18,
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
      <div className="pointer-events-none absolute inset-0 z-map-ui overflow-hidden" aria-hidden>
        {entries.map((entry) => <HazardPin key={entry.properties.id} entry={entry} register={(node) => {
          if (node) nodesRef.current.set(entry.properties.id, node)
          else nodesRef.current.delete(entry.properties.id)
        }} onSelect={(hazard, point) => setSelected({ hazard, point })} />)}
      </div>
      {selected ? <HazardCard hazard={selected.hazard} point={selected.point} onClose={() => setSelected(null)} /> : null}
    </>
  )
}

function HazardPin({
  entry,
  register,
  onSelect,
}: {
  entry: HazardFeature
  register: (node: HTMLButtonElement | null) => void
  onSelect: (hazard: HazardProperties, point: { x: number; y: number }) => void
}) {
  const meta = hazardMeta(entry.properties.hazard_type)
  const severity = HAZARD_SEVERITY_META[entry.properties.severity]
  const Icon = HAZARD_ICONS[entry.properties.hazard_type] ?? TriangleAlert
  return (
    <button
      ref={register}
      type="button"
      aria-label={`${meta.label} in ${entry.properties.zone_name}`}
      className="pointer-events-auto absolute top-0 left-0 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-line bg-surface/92 px-2 py-1 shadow-panel backdrop-blur-xl transition-transform hover:scale-105"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onSelect(entry.properties, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      }}
    >
      <span className="rounded-full bg-surface-2 p-1" style={{ color: meta.color }}>
        <Icon size={14} strokeWidth={1.8} aria-hidden />
      </span>
      <span className="max-w-24 truncate text-left text-2xs font-medium text-ink">{meta.label}</span>
      <span className={cx('size-2 rounded-full ring-2 ring-offset-1 ring-offset-surface', severity?.tone === 'error' ? 'bg-err-fg ring-err-fg/30' : severity?.tone === 'warning' ? 'bg-warn-fg ring-warn-fg/30' : 'bg-accent ring-accent/30')} />
    </button>
  )
}
