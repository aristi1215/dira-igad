import type { CSSProperties, ReactNode } from 'react'
import {
  BAND_COLORS,
  BAND_LABELS,
  IPC_COLORS,
  IPC_LABELS,
  ipcInk,
} from '../lib/format'
import type { OperationalBand } from '../lib/types'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function Card({
  title,
  subtitle,
  children,
  actions,
  className,
  padded = true,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {title || actions ? (
        <div className="card-head">
          <div>
            {title ? <h2 className="card-title">{title}</h2> : null}
            {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? 'card-body' : 'card-body flush'}>{children}</div>
    </section>
  )
}

export function BandChip({
  band,
  acknowledged = false,
}: {
  band: OperationalBand | null | undefined
  acknowledged?: boolean
}) {
  if (acknowledged) {
    return (
      <span className="chip" style={{ background: '#defbe6', color: '#0e6027' }}>
        Acknowledged
      </span>
    )
  }
  if (!band) {
    return (
      <span className="chip" style={{ background: '#f4f4f4', color: '#525252' }}>
        No band
      </span>
    )
  }
  const bg = BAND_COLORS[band]
  const lightText = band === 'watch'
  return (
    <span
      className="chip"
      style={{ background: bg, color: lightText ? '#161616' : '#ffffff' }}
    >
      {BAND_LABELS[band]}
    </span>
  )
}

export function IpcChip({ phase }: { phase: number | null | undefined }) {
  if (phase == null) {
    return (
      <span className="chip" style={{ background: '#f4f4f4', color: '#525252' }}>
        IPC —
      </span>
    )
  }
  return (
    <span
      className="chip"
      style={{ background: IPC_COLORS[phase] ?? '#f4f4f4', color: ipcInk(phase) }}
    >
      IPC {phase} · {IPC_LABELS[phase] ?? ''}
    </span>
  )
}

export function StatusChip({
  tone,
  children,
}: {
  tone: 'success' | 'error' | 'warning' | 'info' | 'neutral'
  children: ReactNode
}) {
  const styles: Record<string, CSSProperties> = {
    success: { background: '#defbe6', color: '#0e6027' },
    error: { background: '#fff1f1', color: '#a2191f' },
    warning: { background: '#fcf4d6', color: '#684e00' },
    info: { background: '#edf5ff', color: '#0043ce' },
    neutral: { background: '#f4f4f4', color: '#525252' },
  }
  return (
    <span className="chip" style={styles[tone]}>
      {children}
    </span>
  )
}

export function StatTile({
  label,
  value,
  detail,
  accent,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  accent?: string
}) {
  return (
    <div className="stat-tile" style={accent ? { borderTopColor: accent } : undefined}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>
}

export function LoadingNote({ children = 'Loading…' }: { children?: ReactNode }) {
  return <p className="loading-note">{children}</p>
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Request failed'
  return <p className="error-note">{message}</p>
}

/** Small horizontal meter for scores in [0, 1] — track is a lighter step of the fill's ramp. */
export function ScoreMeter({
  value,
  color = '#0f62fe',
  track = '#d0e2ff',
}: {
  value: number | null | undefined
  color?: string
  track?: string
}) {
  const v = Math.max(0, Math.min(1, value ?? 0))
  return (
    <span className="score-meter" style={{ background: track }}>
      <span style={{ width: `${v * 100}%`, background: color }} />
    </span>
  )
}
