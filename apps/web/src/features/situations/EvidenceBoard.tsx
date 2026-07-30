import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bug,
  ClipboardCheck,
  FileQuestion,
  Mountain,
  MountainSnow,
  Newspaper,
  Sun,
  Thermometer,
  TriangleAlert,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { fetchZoneSignals, queryKeys } from '../../lib/api'
import { fmtDate, titleCase } from '../../lib/format'
import { hazardMeta, HAZARD_SEVERITY_META } from '../../lib/explain'
import type { FieldReport, HazardBulletin, ZoneSignal } from '../../lib/types'
import { Meter, Skeleton, StatusChip, Tabs } from '../../components/ui'
import { cx } from '../../lib/cx'
import { SignalDetailModal } from './SignalDetailModal'
import { FieldReportModal } from './FieldReportModal'
import { HazardDetailModal } from './HazardBulletins'

const HAZARD_ICONS: Record<string, LucideIcon> = {
  drought: Sun,
  flood: Waves,
  heat: Thermometer,
  locust: Bug,
  volcanic: Mountain,
  earthquake: Zap,
  landslide: MountainSnow,
}

type EvidenceTab = 'signals' | 'reports' | 'hazards'

/**
 * All three kinds of evidence, side by side.
 *
 * This was a tabbed card: one strip of evidence visible at a time inside a
 * full-width panel, so two thirds of what corroborates a forecast was always
 * hidden while the card simultaneously looked empty. Three columns show the
 * whole picture at once and fill the width with content instead of padding.
 *
 * Tabs survive below `lg`, where three columns genuinely will not fit.
 */
export function EvidenceBoard({
  zoneId,
  zoneName,
  reports,
  hazards,
}: {
  zoneId: string
  zoneName?: string | null
  reports: FieldReport[]
  hazards: HazardBulletin[]
}) {
  const [tab, setTab] = useState<EvidenceTab>('signals')

  const signalsQuery = useQuery({
    queryKey: queryKeys.zoneSignals(zoneId),
    queryFn: () => fetchZoneSignals(zoneId),
    enabled: zoneId.length > 0,
  })
  const signals = signalsQuery.data ?? []
  const verified = reports.filter((report) => report.status === 'verified')

  const columns: { id: EvidenceTab; node: ReactNode }[] = [
    {
      id: 'signals',
      node: (
        <SignalsColumn
          signals={signals}
          zoneName={zoneName}
          loading={signalsQuery.isLoading}
        />
      ),
    },
    { id: 'reports', node: <ReportsColumn reports={verified} zoneName={zoneName} /> },
    { id: 'hazards', node: <HazardsColumn hazards={hazards} zoneName={zoneName} /> },
  ]

  return (
    <div>
      {/* Narrow screens keep the original one-at-a-time behaviour. */}
      <div className="mb-3 lg:hidden">
        <Tabs
          items={[
            { id: 'signals', label: 'News', count: signals.length || undefined },
            { id: 'reports', label: 'Field reports', count: verified.length || undefined },
            { id: 'hazards', label: 'Hazards', count: hazards.length || undefined },
          ]}
          value={tab}
          onChange={setTab}
          layoutId="evidence-tabs"
          ariaLabel="Evidence type"
          size="sm"
        />
      </div>

      <div className="lg:hidden">{columns.find((column) => column.id === tab)?.node}</div>

      <div className="hidden gap-px bg-line lg:grid lg:grid-cols-3">
        {columns.map((column) => (
          <div key={column.id} className="min-w-0 bg-surface">
            {column.node}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Column shell.
 *
 * The scroll cap is what lets all three sit side by side without the tallest
 * one dictating a page of whitespace for the other two.
 */
function Column({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string
  count: number
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Icon size={13} strokeWidth={1.75} aria-hidden className="shrink-0 text-faint" />
        <h3 className="flex-1 text-eyebrow text-faint uppercase">
          {title}
        </h3>
        <span
          className={cx(
            'font-mono text-2xs tabular-nums',
            count === 0 ? 'text-line-strong' : 'text-ink',
          )}
        >
          {count}
        </span>
      </header>
      <div className="max-h-[26rem] min-h-[8rem] flex-1 overflow-y-auto p-2">{children}</div>
    </section>
  )
}

/**
 * Compact empty note.
 *
 * The shared `EmptyState` is a centred block with `py-8`, which inside a
 * one-third column reads as a hole. Evidence being absent is ordinary and
 * should be stated in a line, not memorialised in whitespace.
 */
function NoneYet({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 px-1 py-3 text-xs leading-relaxed text-faint">
      <FileQuestion size={13} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />
      {children}
    </p>
  )
}

const ROW = cx(
  'w-full rounded-md border border-line bg-surface px-2.5 py-2 text-left',
  'transition-colors duration-[120ms] ease-standard',
  'hover:border-accent hover:bg-accent-soft',
)

function SignalsColumn({
  signals,
  zoneName,
  loading,
}: {
  signals: ZoneSignal[]
  zoneName?: string | null
  loading: boolean
}) {
  const [selected, setSelected] = useState<ZoneSignal | null>(null)

  return (
    <Column title="News signals" count={signals.length} icon={Newspaper}>
      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16" />
          ))}
        </div>
      ) : signals.length === 0 ? (
        <NoneYet>No news signals extracted for this zone this cycle.</NoneYet>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {signals.slice(0, 12).map((signal) => (
            <li key={signal.id}>
              <button type="button" className={ROW} onClick={() => setSelected(signal)}>
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {titleCase(signal.signal_type)}
                  </span>
                  <StatusChip
                    tone={
                      signal.status === 'confirmed'
                        ? 'success'
                        : signal.status === 'dismissed'
                          ? 'neutral'
                          : 'warning'
                    }
                  >
                    {signal.status}
                  </StatusChip>
                </span>

                {signal.title ? (
                  <span className="mt-1 line-clamp-2 block text-xs leading-snug text-muted">
                    {signal.title}
                  </span>
                ) : null}

                {/* Confidence as a bar: a bare "62%" is hard to rank against
                    the row above it at a glance. */}
                <span className="mt-1.5 flex items-center gap-1.5">
                  <Meter
                    value={signal.confidence}
                    color="var(--color-accent)"
                    track="var(--color-accent-ring)"
                    height="sm"
                    className="flex-1"
                  />
                  <span className="font-mono text-2xs tabular-nums text-faint">
                    {Math.round(signal.confidence * 100)}%
                  </span>
                </span>

                <span className="mt-1 block truncate font-mono text-2xs text-faint">
                  {[signal.source, signal.published_at ? fmtDate(signal.published_at) : null]
                    .filter(Boolean)
                    .join(' · ') || 'Source pending'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <SignalDetailModal
          signal={selected}
          zoneName={zoneName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </Column>
  )
}

function ReportsColumn({
  reports,
  zoneName,
}: {
  reports: FieldReport[]
  zoneName?: string | null
}) {
  const [selected, setSelected] = useState<FieldReport | null>(null)

  return (
    <Column title="Verified field reports" count={reports.length} icon={ClipboardCheck}>
      {reports.length === 0 ? (
        <NoneYet>
          None verified. Unverified reports contribute exactly zero corroboration until
          someone verifies them.
        </NoneYet>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {reports.slice(0, 12).map((report) => (
            <li key={report.id}>
              <button type="button" className={ROW} onClick={() => setSelected(report)}>
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {titleCase(report.category)}
                  </span>
                  <span
                    aria-label={`Severity ${report.severity} of 3`}
                    className="flex shrink-0 gap-0.5"
                  >
                    {[1, 2, 3].map((step) => (
                      <span
                        key={step}
                        aria-hidden
                        className={cx(
                          'block h-2.5 w-1 rounded-xs',
                          step <= report.severity ? 'bg-band-elevated' : 'bg-line',
                        )}
                      />
                    ))}
                  </span>
                </span>
                <span className="mt-1 line-clamp-2 block text-xs leading-snug text-muted">
                  {report.narrative}
                </span>
                <span className="mt-1 block truncate font-mono text-2xs text-faint">
                  {titleCase(report.reporter_role)} · {fmtDate(report.reported_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <FieldReportModal
          report={selected}
          zoneName={zoneName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </Column>
  )
}

function HazardsColumn({
  hazards,
  zoneName,
}: {
  hazards: HazardBulletin[]
  zoneName?: string | null
}) {
  const [selected, setSelected] = useState<HazardBulletin | null>(null)

  const now = new Date()
  const isActive = (bulletin: HazardBulletin) => {
    const from = new Date(bulletin.valid_from)
    const to = bulletin.valid_to ? new Date(bulletin.valid_to) : null
    return from <= now && (to === null || to >= now)
  }

  const sorted = [...hazards].sort((a, b) => {
    const activeDiff = Number(isActive(b)) - Number(isActive(a))
    return activeDiff !== 0 ? activeDiff : b.valid_from.localeCompare(a.valid_from)
  })

  return (
    <Column title="Hazard bulletins" count={hazards.length} icon={TriangleAlert}>
      {sorted.length === 0 ? (
        <NoneYet>No active or recent bulletins for this zone.</NoneYet>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sorted.slice(0, 12).map((bulletin) => {
            const meta = hazardMeta(bulletin.hazard_type)
            const severity = HAZARD_SEVERITY_META[bulletin.severity]
            const Icon = HAZARD_ICONS[bulletin.hazard_type] ?? TriangleAlert
            const active = isActive(bulletin)
            return (
              <li key={bulletin.id}>
                <button
                  type="button"
                  className={cx(ROW, 'border-l-[3px]')}
                  style={{ borderLeftColor: meta.color }}
                  onClick={() => setSelected(bulletin)}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon
                      size={13}
                      strokeWidth={1.75}
                      aria-hidden
                      className="shrink-0"
                      style={{ color: meta.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                      {meta.label}
                    </span>
                    <StatusChip tone={active ? (severity?.tone ?? 'info') : 'neutral'}>
                      {active ? bulletin.severity : 'expired'}
                    </StatusChip>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-snug text-muted">
                    {bulletin.headline}
                  </span>
                  <span className="mt-1 block truncate font-mono text-2xs text-faint">
                    {fmtDate(bulletin.valid_from)} →{' '}
                    {bulletin.valid_to ? fmtDate(bulletin.valid_to) : 'open'} ·{' '}
                    {bulletin.source}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {selected ? (
        <HazardDetailModal
          bulletin={selected}
          zoneName={zoneName}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </Column>
  )
}
