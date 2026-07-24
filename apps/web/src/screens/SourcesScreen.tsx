import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSources, queryKeys } from '../lib/api'
import { fmtDateTime, fmtNumber, titleCase } from '../lib/format'
import {
  Card,
  ErrorNote,
  LoadingNote,
  PageHeader,
  StatusChip,
} from '../components/ui'
import type { DataSource } from '../lib/types'

export function SourcesScreen() {
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: fetchSources,
  })

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

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Transparency"
        title="Data sources"
        description="Every input to the situation room, its mode, freshness and licence. Nothing here is a black box: if a number appears on another screen, its source appears on this one."
      />

      {sourcesQuery.isLoading ? <LoadingNote /> : null}
      {sourcesQuery.isError ? <ErrorNote error={sourcesQuery.error} /> : null}

      {data ? (
        <>
          <Card
            title={`Data mode: ${data.data_mode.toUpperCase()}`}
            subtitle={
              data.data_mode === 'seeded'
                ? 'Deterministic, network-free demo fixtures. Live-capable connectors switch on with DATA_MODE=live and always degrade back to the seeded snapshot on failure.'
                : 'Live connectors active — each degrades independently to the seeded snapshot on failure.'
            }
          >
            <p className="gate-note">{data.bitemporal_note}</p>
          </Card>

          {byCategory.map(([category, sources]) => (
            <Card key={category} title={titleCase(category)}>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Mode</th>
                      <th>Live endpoint</th>
                      <th>Cadence</th>
                      <th className="num">Rows</th>
                      <th>Freshest available_at</th>
                      <th>Licence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((source) => (
                      <tr key={source.key}>
                        <td>
                          <strong>{source.name}</strong>
                        </td>
                        <td>
                          <StatusChip
                            tone={source.mode === 'live' ? 'success' : 'neutral'}
                          >
                            {source.mode}
                          </StatusChip>{' '}
                          {source.live_capable && source.mode !== 'live' ? (
                            <StatusChip tone="info">live-capable</StatusChip>
                          ) : null}
                        </td>
                        <td className="mono muted">{source.live_endpoint || '—'}</td>
                        <td className="muted">{source.cadence}</td>
                        <td className="num">{fmtNumber(source.rows)}</td>
                        <td className="muted">
                          {source.freshest_available_at
                            ? fmtDateTime(source.freshest_available_at)
                            : '—'}
                        </td>
                        <td className="muted">{source.licence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          <Card
            title="Red lines"
            subtitle="Non-negotiable safety rules, enforced in code and schema — not in prose"
          >
            <ul className="red-lines">
              <li>
                <strong>Human gate.</strong> No alert is dispatched without a named
                approver — a database CHECK constraint, not a UI convention.
              </li>
              <li>
                <strong>Unverified means zero.</strong> Unverified news signals and
                field reports contribute exactly 0 to corroboration until a human
                verifies them; dismissed reports stay at 0 forever.
              </li>
              <li>
                <strong>Model risk stays pure.</strong> The new information layers
                (IPC, displacement, prices, health, hazards) are context and
                corroboration — never silent model features.
              </li>
              <li>
                <strong>Visible arithmetic.</strong> The exact combination rule that
                produced every operational band is stored as plain text on the
                assessment row.
              </li>
              <li>
                <strong>Do no harm.</strong> Alert wording avoids blame, names no
                groups, and directs recipients toward safety actions only.
              </li>
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  )
}
