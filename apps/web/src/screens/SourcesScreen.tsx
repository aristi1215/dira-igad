import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, ShieldCheck } from 'lucide-react'
import { fetchSources, queryKeys } from '../lib/api'
import { fmtNumber, titleCase } from '../lib/format'
import {
  Callout,
  Card,
  ErrorNote,
  InfoHint,
  PageHeader,
  Screen,
  SkeletonCard,
  Stat,
  StatRow,
  StatusChip,
} from '../components/ui'
import type { DataSource } from '../lib/types'

/** How long ago, in the plainest words that are still accurate. */
function freshness(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'unknown'
  const hours = Math.round(ms / 3_600_000)
  if (hours < 1) return 'under an hour ago'
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export function SourcesScreen() {
  const sourcesQuery = useQuery({ queryKey: queryKeys.sources, queryFn: fetchSources })
  const data = sourcesQuery.data

  const byCategory = useMemo(() => {
    const groups = new Map<string, DataSource[]>()
    for (const source of data?.sources ?? []) {
      const list = groups.get(source.category) ?? []
      list.push(source)
      groups.set(source.category, list)
    }
    return [...groups.entries()]
  }, [data?.sources])

  const sources = data?.sources ?? []
  const liveCount = sources.filter((source) => source.mode === 'live').length
  const liveCapable = sources.filter((source) => source.live_capable).length
  const freshest = sources
    .map((source) => source.freshest_available_at)
    .filter((value): value is string => value != null)
    .sort()
    .at(-1)

  return (
    <Screen>
      <PageHeader
        eyebrow="Transparency"
        title="Where the numbers come from"
        description="Every input to the situation room, with its mode, freshness and licence. If a figure appears anywhere else in Dira, its source appears here."
      />

      {/*
        The red lines are the credibility statement, so they lead rather than
        sitting at the bottom of the page as an appendix.
      */}
      <Card
        title="Red lines"
        subtitle="Enforced in code and database schema — not in prose"
        className="mb-5"
      >
        <ul className="grid gap-3 md:grid-cols-2">
          {[
            {
              title: 'A human always approves',
              body: 'No alert is dispatched without a named approver. That is a database constraint, not a UI convention.',
            },
            {
              title: 'Unverified means zero',
              body: 'Unverified reports and signals contribute exactly 0 corroboration until a person verifies them. Dismissed ones stay at 0 forever.',
            },
            {
              title: 'The forecast stays pure',
              body: 'Food security, displacement, prices, health and hazards are context and corroboration — never silent model inputs.',
            },
            {
              title: 'The arithmetic is visible',
              body: 'The exact rule that produced every band is stored as plain text on the assessment itself.',
            },
            {
              title: 'Do no harm',
              body: 'Alert wording avoids blame, names no groups, and directs recipients only toward safety actions.',
            },
          ].map((rule) => (
            <li key={rule.title} className="flex gap-2.5">
              <ShieldCheck
                size={15}
                strokeWidth={1.75}
                aria-hidden
                className="mt-0.5 shrink-0 text-band-ack"
              />
              <span className="text-sm">
                <span className="font-medium text-ink">{rule.title}.</span>{' '}
                <span className="text-muted">{rule.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {sourcesQuery.isError ? <ErrorNote error={sourcesQuery.error} className="mb-4" /> : null}
      {sourcesQuery.isLoading ? <SkeletonCard /> : null}

      {data ? (
        <>
          <StatRow className="mb-5">
            <Stat label="Feeds" value={sources.length} detail="Distinct inputs" />
            <Stat
              label="Reading live"
              value={liveCount}
              detail={`${liveCapable} can go live`}
              accent={liveCount > 0 ? 'var(--color-band-ack)' : undefined}
            />
            <Stat
              label="Freshest record"
              value={freshness(freshest ?? null)}
              detail="Newest available_at across all feeds"
            />
            <Stat
              label="Mode"
              value={data.data_mode === 'live' ? 'Live' : 'Demo'}
              detail={
                data.data_mode === 'live'
                  ? 'Connectors reading real endpoints'
                  : 'Fixed fixtures, identical every run'
              }
            />
          </StatRow>

          <Callout tone="info" className="mb-5" icon={Radio}>
            <span className="flex flex-wrap items-center gap-1.5">
              {data.bitemporal_note}
              <InfoHint content="Every record carries the date it describes and the date it became available. Assessments only ever read what was knowable at the time — so a rerun of an old cycle cannot cheat with hindsight." />
            </span>
          </Callout>

          <div className="flex flex-col gap-5">
            {byCategory.map(([category, categorySources]) => (
              <Card key={category} title={titleCase(category)} padded={false}>
                <div className="w-full overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line">
                        {['Source', 'Mode', 'Updated', 'Cadence', 'Rows', 'Licence'].map(
                          (header, index) => (
                            <th
                              key={header}
                              scope="col"
                              className={`px-3 py-2 text-2xs font-medium tracking-[0.04em] text-muted uppercase ${
                                index === 4 ? 'text-right' : 'text-left'
                              }`}
                            >
                              {header}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {categorySources.map((source) => (
                        <tr key={source.key} className="border-b border-line last:border-b-0">
                          <td className="px-3 py-2.5">
                            <span className="font-medium text-ink">{source.name}</span>
                            {source.live_endpoint ? (
                              <span className="block font-mono text-2xs break-all text-faint">
                                {source.live_endpoint}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5">
                            {source.mode === 'live' ? (
                              <StatusChip tone="success">Live</StatusChip>
                            ) : source.live_capable ? (
                              <StatusChip tone="info">Demo · can go live</StatusChip>
                            ) : (
                              <StatusChip tone="neutral">Demo</StatusChip>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-muted">
                            {freshness(source.freshest_available_at)}
                          </td>
                          <td className="px-3 py-2.5 text-muted">{source.cadence}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                            {fmtNumber(source.rows)}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-faint">{source.licence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>

          <p className="mt-4 text-xs text-faint">
            Freshness is the newest <span className="font-mono">available_at</span> in each feed —
            when Dira could first have known the record, not the date the record describes.
          </p>
        </>
      ) : null}
    </Screen>
  )
}
