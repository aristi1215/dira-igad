/** Operational band -> colour. An acknowledged (reached) zone is painted green. */
import type { OperationalBand } from './types'

export const BAND_COLOR: Record<OperationalBand, string> = {
  green: '#2ecc71',
  yellow: '#f1c40f',
  orange: '#e67e22',
  red: '#e74c3c',
}

export function zoneColor(band: OperationalBand, acknowledged: boolean): string {
  return acknowledged ? BAND_COLOR.green : BAND_COLOR[band]
}
