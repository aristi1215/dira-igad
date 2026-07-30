import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { fetchModelCard, queryKeys } from '../lib/api'
import { CHART, titleCase } from '../lib/format'
import { featureMeta } from '../lib/explain'
import {
  Callout,
  Card,
  BentoCard,
  BentoGrid,
  DataTable,
  EmptyState,
  ErrorNote,
  InfoHint,
  PageHeader,
  Screen,
  SkeletonCard,
  Stat,
  StatRow,
  type Column,
} from '../components/ui'
import { HBarList } from '../components/charts'
import { AskAboutButton } from '../features/advisor'
import type { ModelCard as ModelCardType } from '../lib/types'

/** The shape is declared inline on ModelCard; name it once for the table. */
type EvaluationRun = NonNullable<ModelCardType['evaluation_runs']>[number]

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

  const evaluationColumns: Column<EvaluationRun>[] = [
    {
      key: 'split',
      header: 'Split',
      width: '5rem',
      render: (run) => (
        <span className="font-mono tabular-nums">
          {Math.round(run.split_fraction * 100)}/{Math.round((1 - run.split_fraction) * 100)}
        </span>
      ),
      sortBy: (run) => run.split_fraction,
    },
    {
      key: 'period',
      header: 'Test period',
      render: (run) => (
        <span className="font-mono text-2xs text-muted">
          {run.test_cycles[0]} → {run.test_cycles[1]}
        </span>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      align: 'right',
      width: '6rem',
      render: (run) => (
        <span className="font-mono text-ink">
          {fmtMetric(run.lightgbm?.brier ?? run.transparent_index?.brier)}
        </span>
      ),
    },
    {
      key: 'climatology',
      header: 'Climatology',
      align: 'right',
      width: '7rem',
      render: (run) => (
        <span className="font-mono text-faint">
          {fmtMetric(run.baselines?.climatology?.brier)}
        </span>
      ),
    },
  ]

  return (
    <Screen>
      <PageHeader
        eyebrow="Transparency"
        title="How the forecast is made"
        description="What the model predicts, how it was tested, and what it does not claim."
      />

      {!metrics ? (
        <EmptyState title="No evaluated model yet">
          The active model was registered without evaluation metrics. Run the training script
          to train and evaluate it.
        </EmptyState>
      ) : (
        <>
          {/*
            One plain claim, up top — and set in the serif, because this is a
            statement of what the system asserts rather than a readout. It sits
            beside its caveat instead of above it, which also closes the 40% of
            blank card the single paragraph used to leave.
          */}
          <BentoGrid className="mb-5">
          <BentoCard span={2} tone="inverse" eyebrow="The forecast" title="What it predicts">
            <div className="grid items-start gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="max-w-[46ch] text-2xl leading-snug font-semibold tracking-[-0.02em] text-white">
                  {card.predicts}
                </p>
                <p className="mt-2.5 max-w-[58ch] text-sm leading-relaxed text-white/70">
                  It looks about {card.horizon_days} days ahead and is checked only against
                  periods it never saw during training.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Callout
                  tone={beatsBaselines ? 'success' : 'warning'}
                  icon={beatsBaselines ? CircleCheck : TriangleAlert}
                >
                  {beatsBaselines
                    ? 'On periods it never saw, it scores better than every naive baseline we tested it against.'
                    : 'It does not beat every baseline, so the transparent index is preferred.'}
                  {card.fallback_reason ? ` ${card.fallback_reason}` : ''}
                </Callout>
                <AskAboutButton
                  question="In plain language, what does this model predict, and what should I not use it for?"
                  className="self-end"
                />
              </div>
            </div>
          </BentoCard>
          <BentoCard span={2} eyebrow="Horizon" title={`${card.horizon_days} days`}>
            <p className="font-mono text-3xl font-semibold tabular-nums">~{card.horizon_days}</p>
            <p className="mt-2 text-sm text-muted">{card.horizon_dekads} ten-day periods ahead</p>
          </BentoCard>
          <BentoCard span={2} eyebrow="Training" title="How it was trained">
            <p className="font-mono text-3xl font-semibold tabular-nums">{card.train_rows}</p>
            <p className="mt-2 text-sm text-muted">rows used for training</p>
          </BentoCard>
          </BentoGrid>

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

          <BentoGrid className="mb-5">
            <BentoCard span={4}
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
            </BentoCard>

            <BentoCard span={2}
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
            </BentoCard>

            <BentoCard span={6}
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
            </BentoCard>

            <BentoCard span={6}
              title="How it was tested"
              subtitle="Every test period is strictly later than every training period"
            >
              <DataTable
                columns={evaluationColumns}
                rows={card.evaluation_runs ?? []}
                getRowId={(run) => String(run.split_fraction)}
                caption="Evaluation runs"
                empty={<EmptyState>No evaluation runs recorded.</EmptyState>}
              />
            </BentoCard>
          </BentoGrid>

          <Card
            title="What it looks at"
            subtitle="The same feature builder runs at training and at serving time, with bitemporal cutoffs so no future information can leak in"
          >
            {/*
              Each group is a bordered card with its own count. As four bare
              columns of three short labels, this read as a list that had run
              out rather than as a deliberate inventory of what the model sees.
            */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {featureGroups.map(([group, features]) => (
                <div key={group} className="rounded-md border border-line bg-surface-2 p-3">
                  <h3 className="mb-2 flex items-baseline gap-1.5 text-eyebrow text-faint uppercase">
                    {titleCase(group)}
                    <span className="font-mono tabular-nums text-line-strong">
                      {features.length}
                    </span>
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
