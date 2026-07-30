import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchRegionalIndicators, queryKeys } from '../lib/api'
import { BAND_LABELS, BAND_MAP_COLORS, BAND_ORDER } from '../lib/format'
import type { OperationalBand } from '../lib/types'
import { useMapUiStore } from '../stores/mapUi'

/**
 * Regional pressure, as three pixels of chrome.
 *
 * The band distribution across all 22 zones, always on, directly under the
 * command bar. It answers "how is the region doing" from every screen without
 * being asked, and clicking a segment isolates that band on the map — so the
 * ambient readout is also the fastest route back to the work.
 *
 * Reuses the `/indicators/regional` query the map already holds; TanStack
 * dedupes, so on the map route this costs nothing at all.
 */
export function PressureRibbon() {
  const navigate = useNavigate()
  const toggleBand = useMapUiStore((state) => state.toggleBand)
  const resetBands = useMapUiStore((state) => state.resetBands)

  const { data } = useQuery({
    queryKey: queryKeys.regionalIndicators,
    queryFn: fetchRegionalIndicators,
    staleTime: 60_000,
  })

  const segments = useMemo(() => {
    const counts = new Map<OperationalBand, number>()
    for (const feature of data?.features ?? []) {
      // A zone with no assessment this cycle is not "low" — it is unknown, and
      // silently folding it into low would overstate how quiet the region is.
      const band = feature.properties.operational_band
      if (!band) continue
      counts.set(band, (counts.get(band) ?? 0) + 1)
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    if (total === 0) return []

    return BAND_ORDER.filter((band): band is OperationalBand => band !== 'none')
      .map((band) => ({ band, count: counts.get(band) ?? 0 }))
      .filter((segment) => segment.count > 0)
      .map((segment) => ({ ...segment, share: segment.count / total, total }))
  }, [data])

  if (segments.length === 0) {
    return <div aria-hidden className="h-1 shrink-0 bg-line" />
  }

  return (
    <div
      className="flex h-1 shrink-0 overflow-hidden"
      role="img"
      aria-label={`Regional pressure: ${segments
        .map((segment) => `${segment.count} ${BAND_LABELS[segment.band]}`)
        .join(', ')}`}
    >
      {/*
        A native title rather than the Tooltip primitive: Tooltip wraps its
        child in an inline-flex span, which would become the flex item here and
        collapse the proportional widths this strip exists to show.
      */}
      {segments.map((segment) => (
        <button
          key={segment.band}
          type="button"
          title={`${segment.count} of ${segment.total} zones — ${BAND_LABELS[segment.band]}. Click to isolate on the map.`}
          aria-label={`${segment.count} zones at ${BAND_LABELS[segment.band]}`}
          onClick={() => {
            resetBands()
            toggleBand(segment.band)
            navigate('/')
          }}
          className="h-full transition-[flex-grow] duration-[300ms] ease-standard hover:brightness-110"
          style={{ flexGrow: segment.share, background: BAND_MAP_COLORS[segment.band] }}
        />
      ))}
    </div>
  )
}
