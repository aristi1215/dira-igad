import { useQuery } from '@tanstack/react-query'
import { fetchModelCard, queryKeys } from '../lib/api'
import { CHART, titleCase } from '../lib/format'
import {
  Card,
  EmptyState,
  ErrorNote,
  LoadingNote,
  PageHeader,
  StatTile,
  StatusChip,
} from '../components/ui'

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

  if (cardQuery.isLoading) {
    return (
      <div className="screen">
        <LoadingNote>Loading model card…</LoadingNote>
      </div>
    )
  }
  if (cardQuery.isError || !cardQuery.data) {
    return (
      <div className="screen">
        <PageHeader
          eyebrow="Amani engine"
          title="Model card"
          description="What the risk model predicts, how it was trained, and how accurate it is."
        />
        <ErrorNote
          error={cardQuery.error ?? new Error('No trained model card available')}
        />
      </div>
    )
  }

  const card = cardQuery.data
  if (!card.metrics) {
    return (
      <div className="screen">
        <PageHeader
          eyebrow="Amani engine"
          title="Model card"
          description="What the risk model predicts, how it was trained, and how accurate it is."
        />
        <EmptyState>
          No evaluated model card yet — the active model was registered without
          evaluation metrics. Run scripts/train.py to train and evaluate.
        </EmptyState>
      </div>
    )
  }
  const metrics = card.metrics
  const baselines = metrics.baselines ?? {}
  const active = card.kind === 'lightgbm' ? 'LightGBM' : 'Transparent index'
  const beatsBaselines =
    Object.keys(baselines).length > 0 &&
    Object.values(baselines).every((b) => metrics.brier < b.brier)

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Amani engine"
        title="Model card"
        description="What the risk model predicts, how it was trained, and how accurate it is on held-out future dekads."
      />

      <div className="stat-row">
        <StatTile
          label="Active model"
          value={active}
          detail={card.fallback_reason ? 'Fallback active' : 'Trained artifact'}
          accent={CHART.cat1}
        />
        <StatTile
          label="Forecast horizon"
          value={`${card.horizon_dekads} dekads`}
          detail={`≈ ${card.horizon_days} days ahead`}
        />
        <StatTile
          label="Brier score"
          value={fmtMetric(metrics.brier)}
          detail="Lower is better (0 = perfect)"
        />
        <StatTile
          label="MAE incidents"
          value={fmtMetric(metrics.mae_incidents)}
          detail="Expected-incident error"
        />
        <StatTile
          label="Training rows"
          value={`${card.train_rows} / ${card.test_rows}`}
          detail="Train / held-out test (temporal split)"
        />
      </div>

      <div className="grid-2">
        <Card
          title="What it predicts"
          subtitle="A pressure forecast — never a calendar date, an actor, or a guarantee"
        >
          <p>{card.predicts}</p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Label: {card.label}. Split: {card.temporal_split}.
          </p>
          <div className="feed-item-head">
            <StatusChip tone={beatsBaselines ? 'success' : 'warning'}>
              {beatsBaselines
                ? 'Beats every baseline on held-out dekads'
                : 'Does not beat all baselines — transparent index preferred'}
            </StatusChip>
          </div>
          {card.fallback_reason ? (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              {card.fallback_reason}
            </p>
          ) : null}
        </Card>

        <Card
          title="Accuracy vs baselines"
          subtitle="Held-out future dekads — same features the live pipeline serves (train ≡ serve)"
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Brier ↓</th>
                  <th className="num">MAE ↓</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>{active} (active)</strong>
                  </td>
                  <td className="num">{fmtMetric(metrics.brier)}</td>
                  <td className="num">{fmtMetric(metrics.mae_incidents)}</td>
                </tr>
                {metrics.transparent_index && card.kind === 'lightgbm' ? (
                  <tr>
                    <td>Transparent index</td>
                    <td className="num">
                      {fmtMetric(metrics.transparent_index.brier)}
                    </td>
                    <td className="num">
                      {fmtMetric(metrics.transparent_index.mae_incidents)}
                    </td>
                  </tr>
                ) : null}
                {Object.entries(baselines).map(([name, m]) => (
                  <tr key={name}>
                    <td className="muted">{titleCase(name)} baseline</td>
                    <td className="num">{fmtMetric(m.brier)}</td>
                    <td className="num">{fmtMetric(m.mae_incidents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Testing performed"
          subtitle="Multiple temporal splits — every test dekad is strictly after every training dekad"
        >
          {card.evaluation_runs && card.evaluation_runs.length > 0 ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Split</th>
                    <th>Test dekads</th>
                    <th className="num">Model Brier</th>
                    <th className="num">Climatology</th>
                  </tr>
                </thead>
                <tbody>
                  {card.evaluation_runs.map((run) => (
                    <tr key={run.split_fraction}>
                      <td>
                        {Math.round(run.split_fraction * 100)}/
                        {Math.round((1 - run.split_fraction) * 100)}
                      </td>
                      <td className="muted">
                        {run.test_cycles[0]} → {run.test_cycles[1]}
                      </td>
                      <td className="num">
                        {fmtMetric(
                          run.lightgbm?.brier ?? run.transparent_index?.brier,
                        )}
                      </td>
                      <td className="num">
                        {fmtMetric(run.baselines?.climatology?.brier)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No evaluation runs recorded.</EmptyState>
          )}
        </Card>

        <Card
          title="Where it performs best and worst"
          subtitle={card.performance_breakdown?.note ?? 'Per-zone error on held-out dekads'}
        >
          {card.performance_breakdown ? (
            <div className="grid-2">
              <div>
                <h4 style={{ margin: '0 0 0.5rem' }}>Best zones</h4>
                <ul className="drivers-list">
                  {card.performance_breakdown.best_zones.map(([zone, err]) => (
                    <li key={zone}>
                      <span>{titleCase(zone)}</span>
                      <span className="driver-value">{err.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 style={{ margin: '0 0 0.5rem' }}>Worst zones</h4>
                <ul className="drivers-list">
                  {card.performance_breakdown.worst_zones.map(([zone, err]) => (
                    <li key={zone}>
                      <span>{titleCase(zone)}</span>
                      <span className="driver-value">{err.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <EmptyState>No breakdown available.</EmptyState>
          )}
        </Card>

        <Card
          title="Features"
          subtitle="Identical feature builder at train and serve time — bitemporal cutoffs, no future information"
        >
          <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {card.feature_list.map((feature) => (
              <span key={feature} className="mono" style={{
                background: '#f4f4f4',
                padding: '0.15rem 0.5rem',
                borderRadius: 4,
                fontSize: '0.75rem',
              }}>
                {feature}
              </span>
            ))}
          </div>
        </Card>

        <Card
          title="Limitations & non-claims"
          subtitle="Read before acting on any forecast"
        >
          <ul className="feed-list">
            {(card.limitations ?? []).map((limitation) => (
              <li key={limitation} className="feed-item">
                <p style={{ margin: 0 }}>{limitation}</p>
              </li>
            ))}
            <li className="feed-item">
              <p style={{ margin: 0 }}>
                It never claims an exact conflict day, actor identity, or that
                violence is guaranteed to occur — and news/field corroboration is
                kept separate from model risk, never blended into it.
              </p>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
