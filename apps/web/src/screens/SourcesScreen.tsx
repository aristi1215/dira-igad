import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, ShieldCheck } from 'lucide-react'
import { fetchSources, queryKeys } from '../lib/api'
import { fmtNumber, titleCase } from '../lib/format'
import {
  Callout,
  Card,
  DataTable,
  ErrorNote,
  Field,
  InfoHint,
  PageHeader,
  Screen,
  Select,
  SkeletonCard,
  Stat,
  StatRow,
  StatusChip,
  type Column,
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
  const [categoryFilter, setCategoryFilter] = useState('all')

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

  const visibleSources =
    categoryFilter === 'all'
      ? sources
      : sources.filter((source) => source.category === categoryFilter)

  const sourceColumns: Column<DataSource>[] = [
    {
      key: 'name',
      header: 'Source',
      render: (source) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink">{source.name}</span>
          {source.live_endpoint ? (
            <span className="font-mono text-2xs break-all text-faint">
              {source.live_endpoint}
            </span>
          ) : null}
        </span>
      ),
      sortBy: (source) => source.name,
    },
    {
      key: 'category',
      header: 'Category',
      width: '9rem',
      render: (source) => <span className="text-muted">{titleCase(source.category)}</span>,
      sortBy: (source) => source.category,
    },
    {
      key: 'mode',
      header: 'Mode',
      width: '11rem',
      render: (source) =>
        source.mode === 'live' ? (
          <StatusChip tone="success">Live</StatusChip>
        ) : source.live_capable ? (
          <StatusChip tone="info">Demo · can go live</StatusChip>
        ) : (
          <StatusChip tone="neutral">Demo</StatusChip>
        ),
      sortBy: (source) => source.mode,
    },
    {
      key: 'updated',
      header: 'Updated',
      width: '8rem',
      render: (source) => (
        <span className="font-mono text-2xs text-muted">
          {freshness(source.freshest_available_at)}
        </span>
      ),
      // Sort by the real timestamp, not by the humanised string — otherwise
      // "under an hour ago" sorts after "3d ago", alphabetically.
      sortBy: (source) => source.freshest_available_at ?? '',
    },
    {
      key: 'cadence',
      header: 'Cadence',
      width: '8rem',
      render: (source) => <span className="text-muted">{source.cadence}</span>,
      sortBy: (source) => source.cadence,
      secondary: true,
    },
    {
      key: 'rows',
      header: 'Rows',
      align: 'right',
      width: '6rem',
      render: (source) => <span className="font-mono">{fmtNumber(source.rows)}</span>,
      sortBy: (source) => source.rows ?? -1,
    },
    {
      key: 'licence',
      header: 'Licence',
      width: '10rem',
      render: (source) => <span className="text-xs text-faint">{source.licence}</span>,
      sortBy: (source) => source.licence,
      secondary: true,
    },
  ]

  return (
    <Screen width="wide">
      <PageHeader
        eyebrow="Transparency"
        title="Where the numbers come from"
        description="Every input to the situation room, with its mode, freshness and licence."
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
        {/*
          Three columns, not two. Five rules across two columns left a literal
          empty half-cell in the bottom right — on the one card whose whole job
          is to look like the system means what it says.
        */}
        <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
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
            {
              title: 'Hindsight is impossible',
              body: 'Every record carries the date it became available, and an assessment reads only what was knowable at its cycle — so re-running an old cycle cannot cheat.',
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

          {/*
            One table, with category as a filterable column.

            This was one card per category, each with its own header chrome
            wrapped around two to four rows — so the page was mostly headings.
            Sorting also only worked within a category, which made the obvious
            question ("what is stalest across everything?") impossible to ask.
          */}
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="Category" className="w-52">
              <Select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All categories</option>
                {byCategory.map(([category, rows]) => (
                  <option key={category} value={category}>
                    {titleCase(category)} ({rows.length})
                  </option>
                ))}
              </Select>
            </Field>
            <span className="mb-1.5 font-mono text-xs tabular-nums text-faint">
              {visibleSources.length} / {sources.length}
            </span>
          </div>

          <Card padded={false}>
            <DataTable
              columns={sourceColumns}
              rows={visibleSources}
              getRowId={(source) => source.key}
              caption="Data sources"
            />
          </Card>

          <p className="mt-4 text-xs text-faint">
            Freshness is the newest <span className="font-mono">available_at</span> in each feed —
            when Dira could first have known the record, not the date the record describes.
          </p>
        </>
      ) : null}
    </Screen>
  )
}
