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
  Card,
  EmptyState,
  ErrorNote,
  IpcChip,
  PageHeader,
  Screen,
  ScreenSkeleton,
  Stat,
  StatRow,
  StatusChip,
} from '../components/ui'
import { TimeSeriesChart } from '../components/charts'
import { ConflictEvents, HazardBulletins, SignalsList } from '../features/situations'
import { ZoneFieldReports } from './zone/ZoneFieldReports'
import { ZoneMarketPrices } from './zone/ZoneMarketPrices'

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

  return (
    <Screen>
      <PageHeader
        eyebrow={`Zone dossier · ${profile.zone.cluster_name}`}
        title={profile.zone.name}
        description={`${
          COUNTRY_NAMES[profile.zone.country_iso2] ?? profile.zone.country_iso2
        } · everything Dira knows about this zone, each observation stamped with when it became available.`}
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

      <section id="climate" className="mb-5 scroll-mt-16">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Rainfall" subtitle="Millimetres per 10-day period">
            {climateData.length > 0 ? (
              <TimeSeriesChart
                data={climateData}
                xKey="dekad"
                xFormatter={fmtMonth}
                series={[{ key: 'rain_mm', label: 'Rain (mm)', kind: 'bar', color: CHART.cat1 }]}
              />
            ) : (
              <EmptyState>No climate series.</EmptyState>
            )}
          </Card>

          <Card
            title="Vegetation"
            subtitle="NDVI mean — plotted separately, never on a second axis"
          >
            {climateData.length > 0 ? (
              <TimeSeriesChart
                data={climateData}
                xKey="dekad"
                xFormatter={fmtMonth}
                series={[{ key: 'ndvi', label: 'NDVI', kind: 'line', color: CHART.cat3 }]}
                yFormatter={(value) => value.toFixed(2)}
              />
            ) : (
              <EmptyState>No vegetation series.</EmptyState>
            )}
          </Card>
        </div>
      </section>

      <section id="conflict" className="mb-5 scroll-mt-16">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Conflict incidents" subtitle="Monthly events and fatalities">
            {profile.incidents_monthly.length > 0 ? (
              <TimeSeriesChart
                data={profile.incidents_monthly as unknown as Record<string, unknown>[]}
                xKey="month"
                xFormatter={fmtMonth}
                series={[
                  { key: 'events', label: 'Events', kind: 'bar', color: CHART.cat1 },
                  { key: 'fatalities', label: 'Fatalities', kind: 'line', color: CHART.cat2 },
                ]}
              />
            ) : (
              <EmptyState>No incident history.</EmptyState>
            )}
          </Card>

          <Card title="Displacement" subtitle="Snapshot counts over time">
            {displacementData.length > 0 ? (
              <TimeSeriesChart
                data={displacementData}
                xKey="date"
                xFormatter={fmtMonth}
                series={[
                  { key: 'idps', label: 'Displaced', kind: 'line', color: CHART.cat1 },
                  { key: 'refugees', label: 'Refugees', kind: 'line', color: CHART.cat4 },
                ]}
              />
            ) : (
              <EmptyState>No displacement snapshots.</EmptyState>
            )}
          </Card>

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
            title="News signals"
            subtitle="Media monitoring feeding the corroboration channel"
          >
            <SignalsList zoneId={id} zoneName={profile.zone.name} />
          </Card>
        </div>
      </section>

      <section id="markets" className="mb-5 scroll-mt-16">
        <div className="mb-5">
          <ZoneMarketPrices rows={profile.market_prices} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Health surveillance" subtitle="Weekly disease reporting">
            {profile.health.length > 0 ? (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {['Week', 'Disease', 'Cases', 'Deaths', 'Status'].map((header, index) => (
                      <th
                        key={header}
                        scope="col"
                        className={`px-2 py-1.5 text-2xs font-medium tracking-[0.04em] text-muted uppercase ${
                          index === 2 || index === 3 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...profile.health]
                    .sort((a, b) => b.week_start.localeCompare(a.week_start))
                    .slice(0, 10)
                    .map((row) => (
                      <tr
                        key={`${row.week_start}-${row.disease}`}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-2 py-2 text-muted">{fmtDate(row.week_start)}</td>
                        <td className="px-2 py-2 text-ink">{titleCase(row.disease)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-ink">{row.cases}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-ink">{row.deaths}</td>
                        <td className="px-2 py-2">
                          <StatusChip
                            tone={
                              row.status === 'outbreak'
                                ? 'error'
                                : row.status === 'alert'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {row.status}
                          </StatusChip>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <EmptyState>No surveillance data.</EmptyState>
            )}
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

        <Card title="Alert recipients" subtitle="Who receives approved voice alerts for this zone">
          {profile.recipients.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['Name', 'Phone', 'Language'].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-2 py-1.5 text-left text-2xs font-medium tracking-[0.04em] text-muted uppercase"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profile.recipients.map((recipient) => (
                  <tr key={recipient.id} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-2 text-ink">{recipient.name}</td>
                    <td className="px-2 py-2 font-mono text-2xs text-muted">
                      {recipient.phone_e164}
                    </td>
                    <td className="px-2 py-2 text-muted">{recipient.language.toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState>No recipients registered.</EmptyState>
          )}
        </Card>
      </section>
    </Screen>
  )
}
