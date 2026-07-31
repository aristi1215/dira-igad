import type { OperationalBand } from './types'

/** Operational band palette (Dira design system — light surfaces). */
export const BAND_COLORS: Record<OperationalBand | 'none' | 'ack', string> = {
  low: '#0f62fe',
  watch: '#f1c21b',
  elevated: '#ff832b',
  high: '#da1e28',
  very_high: '#740937',
  none: '#c6c6c6',
  ack: '#24a148',
}

/** Map fills use a lighter very-high so labels stay readable on the polygon. */
export const BAND_MAP_COLORS: Record<string, string> = {
  ...BAND_COLORS,
  very_high: '#9f1853',
}

export const BAND_LABELS: Record<OperationalBand | 'none', string> = {
  low: 'Stable',
  watch: 'Watch',
  elevated: 'Elevated',
  high: 'High',
  very_high: 'Very high',
  none: 'No band',
}

export const BAND_GUIDANCE: Record<OperationalBand | 'none', string> = {
  very_high: 'Escalation likely — prepare to alert communities now.',
  high: 'Elevated risk — ready contacts and review the situation.',
  elevated: 'Pressure rising — monitor this zone closely.',
  watch: 'Some pressure building — keep watch.',
  low: 'No elevated conflict pressure — the model is not detecting danger here.',
  none: 'Not yet assessed this cycle.',
}

export const BAND_ORDER: (OperationalBand | 'none')[] = [
  'very_high',
  'high',
  'elevated',
  'watch',
  'low',
  'none',
]

/** Official IPC acute food insecurity phase colors. */
export const IPC_COLORS: Record<number, string> = {
  1: '#cdfacd',
  2: '#fae61e',
  3: '#e67800',
  4: '#c80000',
  5: '#640000',
}

export const IPC_LABELS: Record<number, string> = {
  1: 'Minimal',
  2: 'Stressed',
  3: 'Crisis',
  4: 'Emergency',
  5: 'Famine',
}

/*
 * The band and IPC fills are theme-invariant on purpose — they are data
 * semantics, not styling, and `tokens.test.ts` enforces that dark mode leaves
 * them alone. That makes the ink sitting on them theme-invariant too: the
 * semantic `--color-ink` token flips to near-white in dark, which on the pale
 * `ipc-1` fill measured 1.06:1. These two helpers are the single place that
 * answers "what ink clears this fill", and they must return literals.
 */

/** Ink color that clears contrast on an IPC phase fill. */
export function ipcInk(phase: number): string {
  return phase >= 3 ? '#ffffff' : '#161616'
}

/** Ink color that clears contrast on an operational band fill. */
export function bandInk(band: OperationalBand | 'none'): string {
  // `watch` is the one bright fill in the ramp; the rest are dark enough for white.
  return band === 'watch' || band === 'none' ? '#161616' : '#ffffff'
}

export const COUNTRY_NAMES: Record<string, string> = {
  KE: 'Kenya',
  ET: 'Ethiopia',
  SO: 'Somalia',
  SS: 'South Sudan',
  SD: 'Sudan',
  UG: 'Uganda',
  DJ: 'Djibouti',
  ER: 'Eritrea',
}

/**
 * Data hues only. These carry meaning — a series keeps its colour between
 * themes for the same reason a band does — so they are deliberately
 * theme-invariant. Gridlines, axis ink and empty cells are *not* meaningful
 * and live in `lib/chartChrome.ts`, which follows the theme.
 */
export const CHART = {
  cat1: '#0f62fe',
  cat2: '#d02670',
  cat3: '#198038',
  cat4: '#8a3ffc',
  /** Sequential blues, light → dark (IBM blue ramp). */
  blues: ['#edf5ff', '#d0e2ff', '#a6c8ff', '#78a9ff', '#4589ff', '#0f62fe', '#0043ce'],
  /**
   * Diverging, for the one variable in the dataset that has a meaningful
   * zero: staple price against its own 3-month average. Cheaper than usual on
   * the left, dearer on the right, neutral at parity. Blue↔orange rather than
   * the conventional red↔green so it survives the common color deficiencies
   * and does not collide with the band ramp.
   */
  diverging: ['#0043ce', '#4589ff', '#d0e2ff', '#f4f4f4', '#ffd9be', '#ff832b', '#a2191f'],
  /**
   * Kernel-density ramp for the map's heat field, cool → warm through the
   * band hues. Deliberately not the usual green→red: the product's whole
   * color language is these bands, and heat that reads in a foreign palette
   * would look like a second, competing system on the same canvas.
   */
  heat: ['#d0e2ff', '#78a9ff', '#f1c21b', '#ff832b', '#da1e28', '#9f1853'],
}

export function fmtCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${Math.round(value / 1_000)}K`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return `${Math.round(value)}`
}

export function fmtNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

export function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

export function fmtRisk(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(2)
}

export function fmtRiskScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return String(Math.round(value * 100))
}

export function fmtProbability(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${Math.round(value * 100)}%`
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtMonth(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Human copy for the model's forecast window, e.g. "Next ~30 days (1 Aug – 31 Aug)". */
export function fmtForecastWindow(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
  horizonDekads?: number | null,
): string {
  if (!windowStart || !windowEnd) {
    return horizonDekads ? `Next ${horizonDekads} dekads (~${horizonDekads * 10} days)` : '—'
  }
  const start = new Date(windowStart)
  const end = new Date(windowEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—'
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `Next ~${days} days (${start.toLocaleDateString('en-GB', opts)} – ${end.toLocaleDateString('en-GB', opts)})`
}

/**
 * The forecast window split into its parts, so the `ForecastWindow` component
 * can set the dates themselves at display size and demote everything else.
 *
 * The single formatted string above buries the two dates that matter inside a
 * parenthetical, which is why the window read as a caption rather than as the
 * period the alert is actually about.
 */
export function forecastWindowParts(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
  horizonDekads?: number | null,
): { range: string; detail: string | null } {
  const dekadDetail = horizonDekads
    ? `${horizonDekads} ten-day period${horizonDekads === 1 ? '' : 's'} ahead`
    : null

  if (!windowStart || !windowEnd) {
    return {
      range: horizonDekads ? `Next ~${horizonDekads * 10} days` : '—',
      detail: dekadDetail,
    }
  }
  const start = new Date(windowStart)
  const end = new Date(windowEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { range: '—', detail: dekadDetail }
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const sameYear = start.getFullYear() === end.getFullYear()
  // The year appears once, on the end date, unless the window straddles two.
  const startText = start.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const endText = end.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return {
    range: `${startText} – ${endText}`,
    detail: [`~${days} days`, dekadDetail].filter(Boolean).join(' · '),
  }
}

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * A phone number with everything but the last four digits replaced.
 *
 * The dispatch board gets projected on a wall during an incident; full contact
 * numbers for chiefs and field officers do not belong there. Four digits is
 * enough for an operator to confirm they are looking at the right person.
 */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '—'
  const tail = value.slice(-4)
  if (value.length <= 4) return tail
  const prefix = value.startsWith('+') ? '+' : ''
  return `${prefix}••• ${tail}`
}
