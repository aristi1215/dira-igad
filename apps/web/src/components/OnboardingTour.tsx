import { useState } from 'react'

const STORAGE_KEY = 'dira-onboarding-done'

const STEPS = [
  {
    title: 'Welcome to Dira',
    body: 'Dira is an early-warning situation room for the IGAD region. It turns climate, conflict, and field data into a per-zone conflict-pressure forecast — and helps teams warn communities before tensions escalate.',
  },
  {
    title: 'The map',
    body: 'Each circle is an open situation, sized and colored by risk. The base layer shades all 22 zones by the selected overlay (pressure, food security, displacement, incidents, hazards). Click a zone to open its card.',
  },
  {
    title: 'Two scores, never blended',
    body: 'Model risk comes purely from the forecast model. Corroboration comes from news signals and verified field reports. They are combined by a written rule (70/30) that is stored on every assessment — never a black box.',
  },
  {
    title: 'Forecast window',
    body: 'Every assessment predicts pressure over the next ~30 days (3 dekads) — not an exact date of conflict. The Model page explains training, accuracy, and limitations.',
  },
  {
    title: 'Human approval, always',
    body: 'Alerts never dispatch on their own. A named human must approve each alert on the Dispatch page; only then are voice deliveries queued. Recipients confirm with a keypress, which flows back live.',
  },
  {
    title: 'Ask Dira',
    body: 'The advisor answers questions grounded in the selected zone\u2019s situation, signals, hazards, and field reports — with citations. It can never approve or dispatch anything.',
  },
]

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

export function OnboardingTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // ignore storage failures
    }
    onClose()
  }

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Product tour">
      <div className="tour-card">
        <div className="tour-progress">
          {STEPS.map((s, i) => (
            <span key={s.title} className={i <= step ? 'tour-dot active' : 'tour-dot'} />
          ))}
        </div>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <div className="tour-actions">
          <button type="button" className="button button-secondary" onClick={finish}>
            Skip
          </button>
          <span className="spacer" />
          {step > 0 ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="button button-primary"
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
          >
            {isLast ? 'Start exploring' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
