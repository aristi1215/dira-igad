import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { fetchModelCard, queryKeys } from '../lib/api'
import { CHART, titleCase } from '../lib/format'
import { featureMeta } from '../lib/explain'
import {
  Callout,
  Card,
  EmptyState,
  ErrorNote,
  InfoHint,
  PageHeader,
  Screen,
  SkeletonCard,
  Stat,
  StatRow,
} from '../components/ui'
import { HBarList } from '../components/charts'

function fmtMetric(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(3)
}

export function ModelScreen() {
  const cardQuery = useQuery({
    queryKey: queryKeys.modelCard,
    queryFn: fetchModelCard,
    retry: 1,
  })
  const card = cardQuery.data

  /** Group the 13 raw feature names into the four things the model actually looks at. */
  const featureGroups = useMemo(() => {
    const groups = new Map<string, { name: string; label: string; description: string }[]>()
    for (const feature of card?.feature_list ?? []) {
      const meta = featureMeta(feature)
      const list = groups.get(meta.group) ?? []
      list.push({ name: feature, label: meta.label, description: meta.description })
      groups.set(meta.group, list)
    }
    return [...groups.entries()]
  }, [card?.feature_list])

  if (cardQuery.isLoading) {
    return (
      <Screen>
        <PageHeader eyebrow="Transparency" title="How the forecast is made" />
        <SkeletonCard />
      </Screen>
    )
  }

  if (cardQuery.isError || !card) {
    return (
      <Screen>
        <PageHeader
          eyebrow="Transparency"
          title="How the forecast is made"
          description="What the model predicts, how it was tested, and where it falls short."
        />
        <ErrorNote error={cardQuery.error ?? new Error('No trained model card available')} />
      </Screen>
    )
  }

  const metrics = card.metrics
  const baselines = metrics?.baselines ?? {}
  const active = card.kind === 'lightgbm' ? 'LightGBM' : 'Transparent index'
  const beatsBaselines =
    metrics != null &&
    Object.keys(baselines).length > 0 &&
    Object.values(baselines).every((baseline) => metrics.brier < baseline.brier)

  // Three numbers in a table is a chart. Lower Brier is better, so the bars are
  // inverted into "accuracy" to keep longer = better, as people expect.
  const comparison = metrics
    ? [
        { key: 'active', label: `${active} (in use)`, value: metrics.brier },
        ...(metrics.transparent_index && card.kind === 'lightgbm'
          ? [
              {
                key: 'transparent',
                label: 'Transparent index',
                value: metrics.transparent_index.brier,
              },
            ]
          : []),
        ...Object.entries(baselines).map(([name, baseline]) => ({
          key: name,
          label: `${titleCase(name)} baseline`,
          value: baseline.brier,
        })),
      ]
    : []

  return (
    <Screen>
      <PageHeader
        eyebrow="Transparency"
        title="How the forecast is made"
        description="What the model predicts, how it was tested against simpler alternatives, and — just as importantly — what it does not claim."
      />

      {!metrics ? (
        <EmptyState title="No evaluated model yet">
          The active model was registered without evaluation metrics. Run the training script
          to train and evaluate it.
        </EmptyState>
      ) : (
        <>
          {/* One plain claim, up top. */}
          <Card className="mb-5">
            <p className="max-w-[70ch] text-lg leading-snug text-ink">{card.predicts}</p>
            <p className="mt-2 max-w-[70ch] text-sm text-muted">
              It looks about {card.horizon_days} days ahead and is checked only against
              periods it never saw during training.
            </p>
            <div className="mt-3">
              <Callout
                tone={beatsBaselines ? 'success' : 'warning'}
                icon={beatsBaselines ? CircleCheck : TriangleAlert}
              >
                {beatsBaselines
                  ? 'On periods it never saw, it scores better than every naive baseline we tested it against.'
                  : 'It does not beat every baseline, so the transparent index is preferred.'}
                {card.fallback_reason ? ` ${card.fallback_reason}` : ''}
              </Callout>
            </div>
          </Card>

          <StatRow className="mb-5">
            <Stat
              label="Model in use"
              value={active}
              detail={card.fallback_reason ? 'Fallback active' : 'Trained artifact'}
              accent={CHART.cat1}
            />
            <Stat
              label="Looks ahead"
              value={`~${card.horizon_days} days`}
              detail={`${card.horizon_dekads} ten-day periods`}
            />
            <Stat
              label="Brier score"
              value={fmtMetric(metrics.brier)}
              detail="0 is perfect, lower is better"
            />
            <Stat
              label="Tested on"
              value={card.test_rows}
              detail={`held-out rows, after ${card.train_rows} training rows`}
            />
          </StatRow>

          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card
              title="Compared with simpler methods"
              subtitle="Brier score on held-out future periods — shorter is better"
              actions={
                <InfoHint content="Brier score measures how far probability forecasts land from what actually happened. 0 means perfect; 0.25 is what you get by always guessing 50%." />
              }
            >
              <HBarList
                items={comparison.map((row) => ({
                  key: row.key,
                  label: row.label,
                  value: row.value,
                }))}
                formatter={(value) => value.toFixed(3)}
                color={CHART.cat1}
              />
            </Card>

            <Card
              title="What it does not tell you"
              subtitle="Read before acting on any forecast"
            >
              <ul className="flex flex-col gap-2.5">
                {[
                  ...(card.limitations ?? []),
                  'It never names an exact day, an actor, or claims violence is certain. Corroboration from news and field reports is kept separate from model risk and never blended into it.',
                ].map((limitation) => (
                  <li key={limitation} className="flex gap-2.5 text-sm">
                    <span
                      aria-hidden
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-band-elevated"
                    />
                    <span className="text-muted">{limitation}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Where it does best and worst"
              subtitle={card.performance_breakdown?.note ?? 'Per-zone error on held-out periods'}
            >
              {card.performance_breakdown ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
                      Most accurate zones
                    </h3>
                    <HBarList
                      items={card.performance_breakdown.best_zones.map(([zone, error]) => ({
                        key: zone,
                        label: titleCase(zone),
                        value: error,
                      }))}
                      formatter={(value) => value.toFixed(3)}
                      color={CHART.cat3}
                    />
                  </div>
                  <div>
                    <h3 className="mb-2 text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
                      Least accurate zones
                    </h3>
                    <HBarList
                      items={card.performance_breakdown.worst_zones.map(([zone, error]) => ({
                        key: zone,
                        label: titleCase(zone),
                        value: error,
                      }))}
                      formatter={(value) => value.toFixed(3)}
                      color={CHART.cat2}
                    />
                  </div>
                </div>
              ) : (
                <EmptyState>No breakdown available.</EmptyState>
              )}
            </Card>

            <Card
              title="How it was tested"
              subtitle="Every test period is strictly later than every training period"
            >
              {card.evaluation_runs && card.evaluation_runs.length > 0 ? (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      {['Split', 'Test period', 'Model', 'Climatology'].map((header, index) => (
                        <th
                          key={header}
                          scope="col"
                          className={`px-2 py-1.5 text-2xs font-medium tracking-[0.04em] text-muted uppercase ${
                            index > 1 ? 'text-right' : 'text-left'
                          }`}
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.evaluation_runs.map((run) => (
                      <tr key={run.split_fraction} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-2 text-ink">
                          {Math.round(run.split_fraction * 100)}/
                          {Math.round((1 - run.split_fraction) * 100)}
                        </td>
                        <td className="px-2 py-2 font-mono text-2xs text-muted">
                          {run.test_cycles[0]} → {run.test_cycles[1]}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-ink">
                          {fmtMetric(run.lightgbm?.brier ?? run.transparent_index?.brier)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-faint">
                          {fmtMetric(run.baselines?.climatology?.brier)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState>No evaluation runs recorded.</EmptyState>
              )}
            </Card>
          </div>

          <Card
            title="What it looks at"
            subtitle="The same feature builder runs at training and at serving time, with bitemporal cutoffs so no future information can leak in"
          >
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featureGroups.map(([group, features]) => (
                <div key={group}>
                  <h3 className="mb-2 text-2xs font-semibold tracking-[0.04em] text-muted uppercase">
                    {titleCase(group)}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {features.map((feature) => (
                      <li key={feature.name}>
                        <span className="flex items-center gap-1 text-xs text-ink">
                          {feature.label}
                          <InfoHint content={feature.description} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-4 border-t border-line pt-3 text-xs text-faint">
              Label: {card.label}. Split: {card.temporal_split}.
            </p>
          </Card>
        </>
      )}
    </Screen>
  )
}
