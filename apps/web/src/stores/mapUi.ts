import { create } from 'zustand'
import type { OperationalBand, Viewport } from '../lib/types'

/**
 * Ephemeral map UI state.
 *
 * Zone selection and the active overlay deliberately do NOT live here — they
 * are URL search params (see features/map/useSelectedZone.ts) so a view can be
 * shared and survives a reload. What remains is state nobody would want in a
 * link: where the camera happens to be, which bands are hidden, and which zone
 * the cursor is over.
 */
type MapUiState = {
  viewport: Viewport
  hoveredZoneId: string | null
  /** Null means no filter. Otherwise only these bands are shown. */
  bandFilter: Set<OperationalBand> | null
  setViewport: (viewport: Viewport) => void
  setHoveredZoneId: (id: string | null) => void
  toggleBand: (band: OperationalBand) => void
  resetBands: () => void
}

const ALL_BANDS: OperationalBand[] = ['very_high', 'high', 'elevated', 'watch', 'low']

export const useMapUiStore = create<MapUiState>((set) => ({
  viewport: {
    longitude: 38.5,
    latitude: 6.2,
    zoom: 4.4,
  },
  hoveredZoneId: null,
  bandFilter: null,
  setViewport: (viewport) => set({ viewport }),
  setHoveredZoneId: (hoveredZoneId) => set({ hoveredZoneId }),
  toggleBand: (band) =>
    set((state) => {
      // Clicking one swatch on an unfiltered legend isolates that band, which
      // is what people actually mean by the gesture. After that it toggles.
      if (!state.bandFilter) {
        return { bandFilter: new Set([band]) }
      }
      const next = new Set(state.bandFilter)
      if (next.has(band)) {
        next.delete(band)
      } else {
        next.add(band)
      }
      if (next.size === 0 || next.size === ALL_BANDS.length) {
        return { bandFilter: null }
      }
      return { bandFilter: next }
    }),
  resetBands: () => set({ bandFilter: null }),
}))
