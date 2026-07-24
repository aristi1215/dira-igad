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
  low: 'Low',
  watch: 'Watch',
  elevated: 'Elevated',
  high: 'High',
  very_high: 'Very high',
  none: 'No band',
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

/** Ink color that clears contrast on an IPC phase fill. */
export function ipcInk(phase: number): string {
  return phase >= 3 ? '#ffffff' : '#161616'
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

export const CHART = {
  cat1: '#0f62fe',
  cat2: '#d02670',
  cat3: '#198038',
  cat4: '#8a3ffc',
  grid: '#e0e0e0',
  axisInk: '#525252',
  /** Sequential blues, light → dark (IBM blue ramp). */
  blues: ['#edf5ff', '#d0e2ff', '#a6c8ff', '#78a9ff', '#4589ff', '#0f62fe', '#0043ce'],
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
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
