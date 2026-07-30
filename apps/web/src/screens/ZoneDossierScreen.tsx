import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { fetchZoneProfile, queryKeys } from '../lib/api'
import {
  CHART,
  COUNTRY_NAMES,
  fmtCompact,
  fmtDate,
  fmtMonth,
  fmtNumber,
  titleCase,
} from '../lib/format'
import {
  Button,
  BentoCard,
  Card,
  DataTable,
  EmptyState,
  ErrorNote,
  IpcChip,
  PageHeader,
  Screen,
  ScreenSkeleton,
  Stat,
  StatRow,
  StatusChip,
  type Column,
} from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import { ConflictEvents, HazardBulletins, SignalsList } from '../features/situations'
import { ZoneFieldReports } from './zone/ZoneFieldReports'
import { ZoneMarketPrices } from './zone/ZoneMarketPrices'
import type { HealthRow, ZoneProfile } from '../lib/types'

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'climate', label: 'Climate' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'markets', label: 'Markets & health' },
  { id: 'reports', label: 'Reports' },
]

export function ZoneDossierScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const profileQuery = useQuery({
    queryKey: queryKeys.zoneProfile(id),
    queryFn: () => fetchZoneProfile(id),
    enabled: id.length > 0,
  })

  const profile = profileQuery.data
  const latestIpc = profile?.food_security.at(-1) ?? null
  const latestDisplacement = profile?.displacement.at(-1) ?? null

  const climateData = useMemo(
    () =>
      (profile?.climate ?? []).map((row) => ({
        dekad: row.dekad_start,
        rain_mm: row.rain_mm,
        ndvi: row.ndvi_mean,
      })),
    [profile?.climate],
  )

  const displacementData = useMemo(
    () =>
      (profile?.displacement ?? []).map((row) => ({
        date: row.snapshot_date,
        idps: row.idps,
        refugees: row.refugees,
      })),
    [profile?.displacement],
  )

  if (profileQuery.isLoading) {
    return <ScreenSkeleton />
  }
  if (profileQuery.isError || !profile) {
    return (
      <Screen>
        <ErrorNote error={profileQuery.error ?? new Error('Zone not found')} />
      </Screen>
    )
  }

  const situationId =
    profile.situation && typeof profile.situation.id === 'string'
      ? profile.situation.id
      : null

  const healthColumns: Column<HealthRow>[] = [
    {
      key: 'week',
      header: 'Week',
      width: '6rem',
      render: (row) => <span className="font-mono text-2xs text-muted">{fmtDate(row.week_start)}</span>,
      sortBy: (row) => row.week_start,
    },
    {
      key: 'disease',
      header: 'Disease',
      render: (row) => <span className="text-ink">{titleCase(row.disease)}</span>,
      sortBy: (row) => row.disease,
    },
    {
      key: 'cases',
      header: 'Cases',
      align: 'right',
      width: '5rem',
      render: (row) => <span className="font-mono">{row.cases}</span>,
      sortBy: (row) => row.cases,
    },
    {
      key: 'deaths',
      header: 'Deaths',
      align: 'right',
      width: '5rem',
      render: (row) => <span className="font-mono">{row.deaths}</span>,
      sortBy: (row) => row.deaths,
    },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      render: (row) => (
        <StatusChip
          tone={
            row.status === 'outbreak' ? 'error' : row.status === 'alert' ? 'warning' : 'neutral'
          }
        >
          {row.status}
        </StatusChip>
      ),
      sortBy: (row) => row.status,
    },
  ]

  const recipientColumns: Column<ZoneProfile['recipients'][number]>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (recipient) => <span className="font-medium text-ink">{recipient.name}</span>,
      sortBy: (recipient) => recipient.name,
    },
    {
      key: 'phone',
      header: 'Phone',
      width: '10rem',
      render: (recipient) => (
        <span className="font-mono text-2xs text-muted">{recipient.phone_e164}</span>
      ),
    },
    {
      key: 'language',
      header: 'Language',
      width: '6rem',
      render: (recipient) => (
        <span className="font-mono text-2xs text-muted">
          {recipient.language.toUpperCase()}
        </span>
      ),
      sortBy: (recipient) => recipient.language,
    },
  ]

  return (
    <Screen width="wide">
      <PageHeader
        eyebrow={`Zone dossier · ${profile.zone.cluster_name}`}
        title={profile.zone.name}
        description={`${
          COUNTRY_NAMES[profile.zone.country_iso2] ?? profile.zone.country_iso2
        } · every observation, stamped with when it became available.`}
        actions={
          situationId ? (
            <Button
              variant="primary"
              iconRight={ArrowRight}
              onClick={() => void navigate(`/situations/${situationId}`)}
            >
              Open situation
            </Button>
          ) : undefined
        }
      />

      {/* Twelve stacked cards is a scroll marathon without a way to jump. */}
      <nav
        aria-label="Sections"
        className="sticky top-0 z-10 -mx-6 mb-5 flex gap-1 overflow-x-auto border-b border-line bg-canvas/90 px-6 py-2 backdrop-blur-sm"
      >
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-sm px-2.5 py-1 text-xs font-medium whitespace-nowrap text-muted transition-colors duration-[120ms] hover:bg-surface-3 hover:text-ink"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <section id="overview" className="scroll-mt-16">
        <StatRow className="mb-5">
          <Stat
            label="Population"
            value={fmtCompact(profile.exposure?.population ?? null)}
            detail={
              profile.exposure?.pastoralist_share != null
                ? `${Math.round(profile.exposure.pastoralist_share * 100)}% pastoralist`
                : undefined
            }
          />
          <Stat
            label="Food security"
            value={<IpcChip phase={latestIpc?.ipc_phase ?? null} />}
            detail={
              latestIpc?.pop_phase3_plus != null
                ? `${fmtCompact(latestIpc.pop_phase3_plus)} in crisis or worse`
                : undefined
            }
          />
          <Stat
            label="Displaced"
            value={fmtCompact(latestDisplacement?.idps ?? null)}
            detail={
              latestDisplacement ? `as of ${fmtDate(latestDisplacement.snapshot_date)}` : undefined
            }
          />
          <Stat
            label="Water points"
            value={fmtNumber(profile.exposure?.water_points ?? null)}
            detail={`${fmtNumber(profile.exposure?.markets ?? null)} markets`}
          />
          <Stat
            label="Alert recipients"
            value={profile.recipients.length}
            detail="Community focal points"
          />
        </StatRow>
      </section>

      {/*
        Small multiples, not four lonely cards.

        Rain and NDVI were a 220px chart each inside its own titled card, so
        two single-series charts carried four headers' worth of chrome and
        sat 600px apart in reading order. Sharing one frame and one x-axis is
        both denser and the correct comparison — they are the same drought,
        measured twice.
      */}
      <section id="climate" className="mb-5 scroll-mt-16">
        <BentoCard
          span={4}
          tone="inverse"
          title="Climate"
          subtitle="Rain and vegetation over the same 10-day periods — never on a shared axis"
        >
          {climateData.length > 0 ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-1 text-eyebrow text-faint uppercase">
                  Rainfall · mm per 10 days
                </h3>
                <TimeSeriesChart
                  data={climateData}
                  xKey="dekad"
                  xFormatter={fmtMonth}
                  height={180}
                  series={[
                    { key: 'rain_mm', label: 'Rain (mm)', kind: 'bar', color: CHART.cat1 },
                  ]}
                />
              </div>
              <div>
                <h3 className="mb-1 text-eyebrow text-faint uppercase">
                  Vegetation · NDVI mean
                </h3>
                <TimeSeriesChart
                  data={climateData}
                  xKey="dekad"
                  xFormatter={fmtMonth}
                  height={180}
                  series={[{ key: 'ndvi', label: 'NDVI', kind: 'line', color: CHART.cat3 }]}
                  yFormatter={(value) => value.toFixed(2)}
                />
              </div>
            </div>
          ) : (
            <EmptyState>No climate series.</EmptyState>
          )}
        </BentoCard>
      </section>

      <section id="conflict" className="mb-5 scroll-mt-16">
        <Card title="Conflict and displacement" subtitle="Monthly totals and point-in-time counts">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-eyebrow text-faint uppercase">
                Incidents · monthly
              </h3>
              {profile.incidents_monthly.length > 0 ? (
                <TimeSeriesChart
                  data={profile.incidents_monthly as unknown as Record<string, unknown>[]}
                  xKey="month"
                  xFormatter={fmtMonth}
                  height={180}
                  series={[
                    { key: 'events', label: 'Events', kind: 'bar', color: CHART.cat1 },
                    { key: 'fatalities', label: 'Fatalities', kind: 'line', color: CHART.cat2 },
                  ]}
                />
              ) : (
                <EmptyState>No incident history.</EmptyState>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-eyebrow text-faint uppercase">
                Displacement · records at that time
              </h3>
              {displacementData.length > 0 ? (
                <TimeSeriesChart
                  data={displacementData}
                  xKey="date"
                  xFormatter={fmtMonth}
                  height={180}
                  series={[
                    { key: 'idps', label: 'Displaced', kind: 'line', color: CHART.cat1 },
                    { key: 'refugees', label: 'Refugees', kind: 'line', color: CHART.cat4 },
                  ]}
                />
              ) : (
                <EmptyState>No displacement records.</EmptyState>
              )}
            </div>
          </div>
        </Card>

        {/* items-start: these two lists are routinely different lengths, and
            stretching the shorter one produced a column of blank card. */}
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
          <Card
            title="Recent conflict events"
            subtitle="Select an event for actors, source and its contribution to zone risk"
          >
            <ConflictEvents
              events={profile.recent_events.slice(0, 10)}
              zoneName={profile.zone.name}
            />
          </Card>

          <Card
            title="Reports in the news"
            subtitle="Media monitoring that supports the combined score"
          >
            <SignalsList zoneId={id} zoneName={profile.zone.name} />
          </Card>
        </div>
      </section>

      <section id="markets" className="mb-5 scroll-mt-16">
        <div className="mb-5">
          <ZoneMarketPrices rows={profile.market_prices} />
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Card
            title="Health surveillance"
            subtitle="Weekly disease reporting"
            padded={false}
          >
            <DataTable
              columns={healthColumns}
              rows={[...profile.health]
                .sort((a, b) => b.week_start.localeCompare(a.week_start))
                .slice(0, 10)}
              getRowId={(row) => `${row.week_start}-${row.disease}`}
              caption="Weekly disease surveillance"
              empty={<EmptyState>No surveillance data.</EmptyState>}
            />
          </Card>

          <Card
            title="Hazard bulletins"
            subtitle="Drought, flood, heat, locust and geological advisories"
          >
            <HazardBulletins
              bulletins={profile.hazard_bulletins}
              zoneName={profile.zone.name}
            />
          </Card>
        </div>
      </section>

      <section id="reports" className="scroll-mt-16">
        <div className="mb-5">
          <ZoneFieldReports zoneId={id} reports={profile.field_reports} />
        </div>

        {/*
          Three short columns stretched across the full card width left an
          enormous horizontal void per row. Explicit widths keep the data
          together and let the row breathe vertically instead.
        */}
        <Card
          title="Alert recipients"
          subtitle="Who receives approved voice alerts for this zone"
          padded={false}
        >
          <DataTable
            columns={recipientColumns}
            rows={profile.recipients}
            getRowId={(recipient) => recipient.id}
            caption="Alert recipients for this zone"
            empty={<EmptyState>No recipients registered.</EmptyState>}
          />
        </Card>
      </section>
    </Screen>
  )
}
