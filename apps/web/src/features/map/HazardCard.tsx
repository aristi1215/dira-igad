import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { HazardProperties } from '../../lib/types'
import { hazardMeta, HAZARD_ICONS, HAZARD_SEVERITY_META } from '../../lib/explain'
import { fmtDate } from '../../lib/format'
import { placeNearPoint, type Placement } from '../../lib/anchor'
import { DateStamp, IconButton, StatusChip } from '../../components/ui'

export function HazardCard({
  hazard,
  point,
  onClose,
}: {
  hazard: HazardProperties
  point: { x: number; y: number }
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const meta = hazardMeta(hazard.hazard_type)
  const severity = HAZARD_SEVERITY_META[hazard.severity]
  const Icon = HAZARD_ICONS[hazard.hazard_type]

  useLayoutEffect(() => {
    const measure = () => {
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      setPlacement(placeNearPoint(point, { width: rect.width, height: rect.height }))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [point])

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`${meta.label} hazard bulletin`}
      className="pointer-events-auto fixed z-map-panel w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-bento border border-line bg-surface shadow-panel backdrop-blur-xl"
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span className="mt-0.5 rounded-full bg-surface-2 p-2" style={{ color: meta.color }}>
          {Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-ink">{meta.label}</p>
            <StatusChip tone={severity?.tone ?? 'info'}>{severity?.label ?? hazard.severity}</StatusChip>
          </div>
          <p className="mt-1 text-sm font-medium text-ink">{hazard.headline}</p>
          <p className="mt-1 text-xs text-faint">{hazard.zone_name} · {hazard.source}</p>
        </div>
        <IconButton icon={X} label="Close hazard bulletin" size="sm" onClick={onClose} />
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm leading-relaxed text-muted">{meta.description}</p>
        {hazard.detail ? <p className="text-sm leading-relaxed text-muted">{hazard.detail}</p> : null}
        <div className="border-t border-line pt-3">
          <p className="text-eyebrow text-faint">Validity</p>
          <DateStamp className="mt-1">
            {fmtDate(hazard.valid_from)} → {hazard.valid_to ? fmtDate(hazard.valid_to) : 'open-ended'}
          </DateStamp>
        </div>
        {meta.actions.length > 0 ? (
          <div className="border-t border-line pt-3">
            <p className="text-eyebrow text-faint">Preparedness</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
              {meta.actions.map((action) => <li key={action}>{action}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
