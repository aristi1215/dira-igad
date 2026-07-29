import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck, Megaphone, Newspaper } from 'lucide-react'
import { fetchMapSituations, fetchPendingAlerts, queryKeys } from '../lib/api'
import {
  BAND_LABELS,
  BAND_MAP_COLORS,
  COUNTRY_NAMES,
  fmtProbability,
  fmtRisk,
  titleCase,
} from '../lib/format'
import {
  BandChip,
  Card,
  DataTable,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Screen,
  Select,
  Stat,
  StatRow,
  StatusChip,
  Tabs,
  type Column,
} from '../components/ui'
import type { OperationalBand, SituationFeatureProperties } from '../lib/types'

type BandTab = OperationalBand | 'all'

const BAND_TABS: { id: BandTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'very_high', label: BAND_LABELS.very_high },
  { id: 'high', label: BAND_LABELS.high },
  { id: 'elevated', label: BAND_LABELS.elevated },
  { id: 'watch', label: BAND_LABELS.watch },
]

export function SituationsScreen() {
  const navigate = useNavigate()
  const [bandFilter, setBandFilter] = useState<BandTab>('all')
  const [statusFilter, setStatusFilter] = useState('open')
  const [countryFilter, setCountryFilter] = useState('all')

  const situationsQuery = useQuery({
    queryKey: queryKeys.mapSituations,
    queryFn: fetchMapSituations,
  })
  const pendingAlertsQuery = useQuery({
    queryKey: queryKeys.pendingAlerts,
    queryFn: fetchPendingAlerts,
    retry: 1,
  })

  const all = useMemo(
    () =>
      (situationsQuery.data?.features ?? [])
        .map((feature) => feature.properties)
        .sort((a, b) => (b.model_risk ?? -1) - (a.model_risk ?? -1)),
    [situationsQuery.data],
  )

  const countries = useMemo(
    () => [...new Set(all.map((situation) => situation.country_iso2))].sort(),
    [all],
  )

  const filtered = all.filter(
    (situation) =>
      (bandFilter === 'all' || situation.operational_band === bandFilter) &&
      (statusFilter === 'all' || situation.situation_status === statusFilter) &&
      (countryFilter === 'all' || situation.country_iso2 === countryFilter),
  )

  /*
   * Triage, not inventory. The old tiles counted situations, situations again
   * by band, and "with corroboration" — a count of a score, which tells nobody
   * what to do next. These three answer "what is waiting on me?".
   */
  const open = all.filter((situation) => situation.situation_status === 'open')
  const pendingAlerts = pendingAlertsQuery.data ?? []
  const alertedSituationIds = new Set(pendingAlerts.map((alert) => alert.situation_id))
  const needsAlert = open.filter(
    (situation) =>
      (situation.operational_band === 'high' || situation.operational_band === 'very_high') &&
      !alertedSituationIds.has(situation.situation_id),
  )
  const acknowledged = open.filter((situation) => situation.acknowledged)

  const columns: Column<SituationFeatureProperties>[] = [
    {
      key: 'zone',
      header: 'Zone',
      render: (situation) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink">{situation.zone_name}</span>
          <span className="text-2xs text-faint">
            {COUNTRY_NAMES[situation.country_iso2] ?? situation.country_iso2} ·{' '}
            {titleCase(situation.hazard)}
          </span>
        </span>
      ),
      sortBy: (situation) => situation.zone_name,
    },
    {
      key: 'band',
      header: 'Band',
      render: (situation) => <BandChip band={situation.operational_band} />,
      sortBy: (situation) => situation.model_risk ?? -1,
    },
    {
      key: 'model_risk',
      header: 'Model risk',
      align: 'right',
      render: (situation) => fmtRisk(situation.model_risk),
      sortBy: (situation) => situation.model_risk ?? -1,
    },
    {
      key: 'corroboration',
      header: 'Corroboration',
      align: 'right',
      render: (situation) => fmtRisk(situation.corroboration),
      sortBy: (situation) => situation.corroboration ?? -1,
    },
    {
      key: 'evidence',
      header: 'Evidence',
      render: (situation) =>
        (situation.corroboration ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Newspaper size={12} strokeWidth={1.75} aria-hidden />
            Corroborated
          </span>
        ) : (
          <span className="text-xs text-faint">Model only</span>
        ),
      sortBy: (situation) => situation.corroboration ?? -1,
      secondary: true,
    },
    {
      key: 'prob',
      header: 'P(conflict)',
      align: 'right',
      render: (situation) => fmtProbability(situation.prob_conflict),
      sortBy: (situation) => situation.prob_conflict ?? -1,
      secondary: true,
    },
    {
      key: 'status',
      header: 'Status',
      render: (situation) => (
        <StatusChip tone={situation.situation_status === 'open' ? 'warning' : 'neutral'}>
          {situation.situation_status}
        </StatusChip>
      ),
      secondary: true,
    },
    {
      key: 'cycle',
      header: 'Cycle',
      render: (situation) => (
        <span className="font-mono text-2xs text-faint">{situation.cycle ?? '—'}</span>
      ),
      sortBy: (situation) => situation.cycle ?? '',
      secondary: true,
    },
  ]

  return (
    <Screen>
      <PageHeader
        eyebrow="Situation registry"
        title="Situations"
        description="One row per zone and hazard. Model risk is the pure forecast; the band is that score combined with corroboration under the written rule."
      />

      <StatRow className="mb-5">
        <Stat
          label="Needs an alert"
          value={needsAlert.length}
          detail="High or very high, nothing drafted yet"
          accent={BAND_MAP_COLORS.high}
        />
        <Stat
          label="Waiting for approval"
          value={pendingAlerts.length}
          detail="Drafted, held at the human gate"
          accent={BAND_MAP_COLORS.watch}
        />
        <Stat
          label="Acknowledged"
          value={acknowledged.length}
          detail="Recipients confirmed by keypad"
          accent={BAND_MAP_COLORS.ack}
        />
      </StatRow>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Tabs
          items={BAND_TABS}
          value={bandFilter}
          onChange={setBandFilter}
          layoutId="situations-band"
          ariaLabel="Filter by band"
          size="sm"
        />
        <Field label="Status" className="w-36">
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </Select>
        </Field>
        <Field label="Country" className="w-44">
          <Select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}>
            <option value="all">All countries</option>
            {countries.map((iso2) => (
              <option key={iso2} value={iso2}>
                {COUNTRY_NAMES[iso2] ?? iso2}
              </option>
            ))}
          </Select>
        </Field>
        <span className="ml-auto pb-2 text-xs text-faint tabular-nums">
          {filtered.length} of {all.length}
        </span>
      </div>

      {situationsQuery.isError ? <ErrorNote error={situationsQuery.error} /> : null}

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={filtered}
          getRowId={(situation) => situation.situation_id}
          onRowClick={(situation) => void navigate(`/situations/${situation.situation_id}`)}
          rowAccent={(situation) => BAND_MAP_COLORS[situation.operational_band ?? 'none']}
          loading={situationsQuery.isLoading}
          caption="Open and resolved situations"
          empty={
            <EmptyState icon={CheckCircle2} title="Nothing matches">
              No situations match the current filters.
            </EmptyState>
          }
        />
      </Card>

      {needsAlert.length > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Megaphone size={13} strokeWidth={1.75} aria-hidden className="text-band-high" />
          {needsAlert.length} situation{needsAlert.length === 1 ? '' : 's'} at high or very high
          risk {needsAlert.length === 1 ? 'has' : 'have'} no alert drafted yet.
        </p>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <ClipboardCheck size={13} strokeWidth={1.75} aria-hidden className="text-band-ack" />
          Every high-risk situation has an alert drafted or dispatched.
        </p>
      )}
    </Screen>
  )
}
