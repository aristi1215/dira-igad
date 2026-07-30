import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { BAND_LABELS, BAND_MAP_COLORS, COUNTRY_NAMES, fmtCompact, fmtRiskScore } from '../../lib/format'
import type { OperationalBand, ZoneSummary } from '../../lib/types'
import { BandDot, Meter, SearchInput, SkeletonRows } from '../../components/ui'
import { cx } from '../../lib/cx'
import { TOUR_ANCHORS } from '../tour/tourAnchors'

const GROUP_ORDER: (OperationalBand | 'none')[] = [
  'very_high',
  'high',
  'elevated',
  'watch',
  'low',
  'none',
]

const ATTENTION_BANDS: OperationalBand[] = ['high', 'very_high']

export function WatchlistRail({
  zones,
  isLoading,
  selectedZoneId,
  hoveredZoneId,
  bandFilter,
  onSelect,
  onHover,
}: {
  zones: ZoneSummary[]
  isLoading: boolean
  selectedZoneId: string | null
  hoveredZoneId: string | null
  bandFilter: Set<OperationalBand> | null
  onSelect: (zone: ZoneSummary) => void
  onHover: (zoneId: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  /** Landing summary: how many zones need attention, and how many people live there. */
  const summary = useMemo(() => {
    const attention = zones.filter(
      (zone) => zone.operational_band && ATTENTION_BANDS.includes(zone.operational_band),
    )
    const counts = attention.reduce<Record<string, number>>((accumulator, zone) => {
      const band = zone.operational_band as OperationalBand
      accumulator[band] = (accumulator[band] ?? 0) + 1
      return accumulator
    }, {})
    return {
      total: zones.length,
      attention: attention.length,
      people: attention.reduce((sum, zone) => sum + (zone.population ?? 0), 0),
      veryHigh: counts.very_high ?? 0,
      high: counts.high ?? 0,
    }
  }, [zones])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return zones.filter((zone) => {
      if (bandFilter && !bandFilter.has((zone.operational_band ?? 'low') as OperationalBand)) {
        return false
      }
      if (!needle) return true
      return (
        zone.zone_name.toLowerCase().includes(needle) ||
        zone.cluster_name.toLowerCase().includes(needle) ||
        (COUNTRY_NAMES[zone.country_iso2] ?? '').toLowerCase().includes(needle)
      )
    })
  }, [bandFilter, query, zones])

  const groups = useMemo(() => {
    const byBand = new Map<OperationalBand | 'none', ZoneSummary[]>()
    for (const zone of visible) {
      const band = zone.operational_band ?? 'none'
      const bucket = byBand.get(band) ?? []
      bucket.push(zone)
      byBand.set(band, bucket)
    }
    return GROUP_ORDER.filter((band) => byBand.has(band)).map((band) => ({
      band,
      zones: (byBand.get(band) ?? []).sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1)),
    }))
  }, [visible])

  // Keep a map-driven selection visible in the list.
  useEffect(() => {
    if (!selectedZoneId || !listRef.current) return
    listRef.current
      .querySelector(`[data-zone-row="${selectedZoneId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedZoneId])

  return (
    <aside
      aria-label="Zone watchlist"
      data-tour={TOUR_ANCHORS.mapWatchlist}
      /* Narrower below 1280px so the rail plus the zone card do not squeeze
         the map into a sliver on a 1280×720 laptop. */
      className="pointer-events-auto absolute top-3 bottom-14 left-3 z-map-ui flex w-[16rem] max-w-[84vw] flex-col overflow-hidden rounded-bento border border-line bg-surface/92 shadow-panel backdrop-blur-xl xl:w-[19.5rem]"
    >
      <div className="shrink-0 border-b border-line px-3.5 pt-3 pb-2.5">
        {isLoading ? (
          <div className="h-9 animate-pulse rounded-sm bg-surface-3" />
        ) : (
          <>
            <p className="text-md leading-snug font-semibold text-ink">
              {summary.attention === 0
                ? `All ${summary.total} zones are steady this cycle.`
                : `${summary.attention} of ${summary.total} zones need attention.`}
            </p>
            <p className="mt-0.5 text-2xs text-faint">
              {summary.attention === 0
                ? 'Nothing above the elevated threshold right now.'
                : [
                    summary.veryHigh ? `${summary.veryHigh} very high` : null,
                    summary.high ? `${summary.high} high` : null,
                    summary.people ? `${fmtCompact(summary.people)} people` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </>
        )}
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a zone…"
          label="Find a zone"
          className="mt-2.5"
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {isLoading ? (
          <SkeletonRows rows={8} className="px-2" />
        ) : groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-faint">No zones match.</p>
        ) : (
          groups.map((group) => (
            <section key={group.band}>
              <h3 className="sticky top-0 z-1 flex items-center gap-1.5 bg-surface/95 px-2 py-1 text-2xs font-semibold tracking-[0.04em] text-muted uppercase backdrop-blur-sm">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: BAND_MAP_COLORS[group.band] }}
                />
                {BAND_LABELS[group.band]}
                <span className="text-faint normal-case">({group.zones.length})</span>
              </h3>
              <ul>
                {group.zones.map((zone) => {
                  const selected = zone.zone_id === selectedZoneId
                  return (
                    <li key={zone.zone_id}>
                      <button
                        type="button"
                        data-zone-row={zone.zone_id}
                        onClick={() => onSelect(zone)}
                        onMouseEnter={() => onHover(zone.zone_id)}
                        onMouseLeave={() => onHover(null)}
                        className={cx(
                          'group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left',
                          'transition-colors duration-[120ms] ease-standard',
                          selected
                            ? 'bg-accent-soft'
                            : zone.zone_id === hoveredZoneId
                              ? 'bg-surface-3'
                              : 'hover:bg-surface-3',
                        )}
                      >
                        <BandDot band={zone.operational_band} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-ink">
                            {zone.zone_name}
                          </span>
                          <span className="block truncate text-2xs text-faint">
                            {COUNTRY_NAMES[zone.country_iso2] ?? zone.country_iso2} ·{' '}
                            {zone.cluster_name}
                          </span>
                        </span>
                        <span className="flex w-12 shrink-0 flex-col items-end gap-1">
                          <span className="text-xs font-semibold tabular-nums text-ink">
                            {fmtRiskScore(zone.model_risk)}
                          </span>
                          <Meter
                            value={zone.model_risk}
                            height="sm"
                            animate={false}
                            color={BAND_MAP_COLORS[zone.operational_band ?? 'none']}
                            track="var(--color-line)"
                            className="w-full"
                          />
                        </span>
                        <ChevronRight
                          size={13}
                          strokeWidth={1.75}
                          aria-hidden
                          className={cx(
                            'shrink-0 transition-opacity duration-[120ms]',
                            selected ? 'text-accent opacity-100' : 'text-faint opacity-0 group-hover:opacity-100',
                          )}
                        />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
