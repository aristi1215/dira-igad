import { Modal } from '../../components/Modal'
import { BandChip, ScoreMeter } from '../../components/ui'
import { BAND_COLORS, BAND_LABELS, CHART, fmtRisk } from '../../lib/format'
import { BAND_THRESHOLDS, parseCombination } from '../../lib/explain'
import type { SituationDetail } from '../../lib/types'

type Assessment = SituationDetail['assessments'][number]

export function ScoreExplainer({
  assessment,
  onClose,
}: {
  assessment: Assessment
  onClose: () => void
}) {
  const breakdown = parseCombination(
    assessment.combination_rule,
    assessment.model_risk,
    assessment.corroboration,
  )
  const { newsCorroboration, fieldCorroboration, operationalScore, preBumpBand, bumped } =
    breakdown
  const modelTerm = 0.7 * assessment.model_risk
  const corrTerm = 0.3 * assessment.corroboration

  return (
    <Modal
      eyebrow={`Assessment cycle ${assessment.cycle}`}
      title="How the operational band is calculated"
      onClose={onClose}
      wide
    >
      <p className="detail-lede">
        Dira keeps two scores deliberately separate: the <strong>model risk</strong>{' '}
        (a pure climate + conflict-history forecast, never contaminated by media)
        and the <strong>corroboration</strong> (what humans and media are saying
        right now). They are combined by a written rule that is stored verbatim on
        every assessment — the band is never a black box.
      </p>

      <div className="calc-step">
        <span className="calc-step-num">1</span>
        <div className="calc-step-body">
          <h3>Model risk — the pure forecast</h3>
          <p>
            The LightGBM model forecasts conflict pressure over the next{' '}
            {assessment.horizon_dekads ?? 3} dekads from climate and conflict
            history only.
          </p>
          <div className="calc-line">
            <span>Model risk</span>
            <ScoreMeter value={assessment.model_risk} color={CHART.cat1} />
            <strong>{fmtRisk(assessment.model_risk)}</strong>
          </div>
        </div>
      </div>

      <div className="calc-step">
        <span className="calc-step-num">2</span>
        <div className="calc-step-body">
          <h3>Corroboration — two independent channels, merged by max</h3>
          <p>
            News signals and verified field reports corroborate the{' '}
            <em>same</em> underlying tension, so taking the maximum avoids
            double-counting. Unverified or dismissed reports contribute exactly 0.
          </p>
          <div className="calc-line">
            <span>News signals</span>
            <ScoreMeter value={newsCorroboration} color={CHART.cat2} track="#ffd6e8" />
            <strong>{fmtRisk(newsCorroboration)}</strong>
          </div>
          <div className="calc-line">
            <span>Verified field reports</span>
            <ScoreMeter value={fieldCorroboration} color={CHART.cat4} track="#e8daff" />
            <strong>{fmtRisk(fieldCorroboration)}</strong>
          </div>
          <p className="calc-math">
            corroboration = max({fmtRisk(newsCorroboration)},{' '}
            {fmtRisk(fieldCorroboration)}) ={' '}
            <strong>{fmtRisk(assessment.corroboration)}</strong>
          </p>
        </div>
      </div>

      <div className="calc-step">
        <span className="calc-step-num">3</span>
        <div className="calc-step-body">
          <h3>Weighted combination — 70% model, 30% corroboration</h3>
          <p className="calc-math">
            operational score = 0.7 × {fmtRisk(assessment.model_risk)} + 0.3 ×{' '}
            {fmtRisk(assessment.corroboration)} = {modelTerm.toFixed(3)} +{' '}
            {corrTerm.toFixed(3)} = <strong>{operationalScore.toFixed(3)}</strong>
          </p>
        </div>
      </div>

      <div className="calc-step">
        <span className="calc-step-num">4</span>
        <div className="calc-step-body">
          <h3>Score → band thresholds</h3>
          <ul className="band-ladder">
            {BAND_THRESHOLDS.map(({ min, band }) => (
              <li
                key={band}
                className={band === preBumpBand ? 'band-ladder-active' : ''}
              >
                <span
                  className="band-dot"
                  style={{ background: BAND_COLORS[band] }}
                />
                <span>{BAND_LABELS[band]}</span>
                <span className="muted">score ≥ {min.toFixed(2)}</span>
                {band === preBumpBand ? (
                  <strong>← {operationalScore.toFixed(3)}</strong>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="calc-step">
        <span className="calc-step-num">5</span>
        <div className="calc-step-body">
          <h3>Corroboration bump</h3>
          <p>
            If corroboration ≥ 0.70 <em>and</em> the model band is already
            elevated or above, the band is raised one step — strong on-the-ground
            confirmation of an already-worrying forecast warrants extra caution.
          </p>
          <p className="calc-math">
            corroboration {fmtRisk(assessment.corroboration)}{' '}
            {assessment.corroboration >= 0.7 ? '≥' : '<'} 0.70 →{' '}
            {bumped ? (
              <strong>bump applied</strong>
            ) : (
              <strong>no bump</strong>
            )}
          </p>
          <div className="calc-result">
            <span>Final operational band</span>
            <BandChip band={assessment.operational_band} />
          </div>
        </div>
      </div>

      <div className="detail-section detail-note">
        <h3>Rule as persisted on this assessment</h3>
        <p className="rule-text">{assessment.combination_rule}</p>
      </div>
    </Modal>
  )
}
