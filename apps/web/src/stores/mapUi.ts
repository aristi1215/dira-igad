import { create } from 'zustand'
import type { MapOverlay, Viewport } from '../lib/types'

type MapUiState = {
  overlay: MapOverlay
  selectedZoneId: string | null
  selectedSituationId: string | null
  viewport: Viewport
  setOverlay: (overlay: MapOverlay) => void
  setSelectedZoneId: (id: string | null) => void
  setSelectedSituationId: (id: string | null) => void
  setViewport: (viewport: Viewport) => void
}

export const useMapUiStore = create<MapUiState>((set) => ({
  overlay: 'pressure',
  selectedZoneId: null,
  selectedSituationId: null,
  viewport: {
    longitude: 38.5,
    latitude: 6.2,
    zoom: 4.4,
  },
  setOverlay: (overlay) => set({ overlay }),
  setSelectedZoneId: (selectedZoneId) => set({ selectedZoneId }),
  setSelectedSituationId: (selectedSituationId) => set({ selectedSituationId }),
  setViewport: (viewport) => set({ viewport }),
}))
