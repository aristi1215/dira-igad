import type { ReactNode } from 'react'
import { BAND_LABELS, IPC_LABELS } from '../../lib/format'
import type { OperationalBand } from '../../lib/types'
import { cx } from '../../lib/cx'

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium whitespace-nowrap'

/**
 * Band and IPC colors previously arrived as inline hex from lib/format.ts,
 * which meant a third copy of the palette lived here. These lookups use the
 * @theme tokens instead — full literal class names, because Tailwind cannot
 * see an interpolated `bg-band-${band}`.
 */
const BAND_CHIP: Record<OperationalBand | 'none', string> = {
  very_high: 'bg-band-very-high text-white',
  high: 'bg-band-high text-white',
  elevated: 'bg-band-elevated text-white',
  watch: 'bg-band-watch text-ink',
  low: 'bg-band-low text-white',
  none: 'bg-canvas text-muted',
}

export function BandChip({
  band,
  acknowledged = false,
  className,
}: {
  band: OperationalBand | null | undefined
  acknowledged?: boolean
  className?: string
}) {
  if (acknowledged) {
    return (
      <span className={cx(CHIP_BASE, 'bg-ok-bg text-ok-fg', className)}>Acknowledged</span>
    )
  }
  if (!band) {
    return <span className={cx(CHIP_BASE, BAND_CHIP.none, className)}>No band</span>
  }
  return <span className={cx(CHIP_BASE, BAND_CHIP[band], className)}>{BAND_LABELS[band]}</span>
}

/** Small filled circle in the band color — used by the watchlist and legends. */
const BAND_DOT: Record<OperationalBand | 'none', string> = {
  very_high: 'bg-band-very-high',
  high: 'bg-band-high',
  elevated: 'bg-band-elevated',
  watch: 'bg-band-watch',
  low: 'bg-band-low',
  none: 'bg-band-none',
}

export function BandDot({
  band,
  className,
}: {
  band: OperationalBand | null | undefined
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cx('size-2 shrink-0 rounded-full', BAND_DOT[band ?? 'none'], className)}
    />
  )
}

const IPC_CHIP: Record<number, string> = {
  1: 'bg-ipc-1 text-ink',
  2: 'bg-ipc-2 text-ink',
  3: 'bg-ipc-3 text-white',
  4: 'bg-ipc-4 text-white',
  5: 'bg-ipc-5 text-white',
}

export function IpcChip({
  phase,
  className,
}: {
  phase: number | null | undefined
  className?: string
}) {
  if (phase == null || !IPC_CHIP[phase]) {
    return <span className={cx(CHIP_BASE, 'bg-canvas text-muted', className)}>IPC —</span>
  }
  return (
    <span className={cx(CHIP_BASE, IPC_CHIP[phase], className)}>
      IPC {phase} · {IPC_LABELS[phase] ?? ''}
    </span>
  )
}

export type StatusTone = 'success' | 'error' | 'warning' | 'info' | 'neutral'

const STATUS_CHIP: Record<StatusTone, string> = {
  success: 'bg-ok-bg text-ok-fg',
  error: 'bg-err-bg text-err-fg',
  warning: 'bg-warn-bg text-warn-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-canvas text-muted',
}

export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  className?: string
}) {
  return <span className={cx(CHIP_BASE, STATUS_CHIP[tone], className)}>{children}</span>
}
