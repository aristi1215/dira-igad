import { create } from 'zustand'
import type { Viewport } from '../lib/types'

type MapUiState = {
  activeLayers: string[]
  selectedZoneId: string | null
  selectedSituationId: string | null
  viewport: Viewport
  setActiveLayers: (layers: string[]) => void
  setSelectedZoneId: (id: string | null) => void
  setSelectedSituationId: (id: string | null) => void
  setViewport: (viewport: Viewport) => void
}

export const useMapUiStore = create<MapUiState>((set) => ({
  activeLayers: ['situations'],
  selectedZoneId: null,
  selectedSituationId: null,
  viewport: {
    longitude: 41.8,
    latitude: 3.9,
    zoom: 5.4,
  },
  setActiveLayers: (activeLayers) => set({ activeLayers }),
  setSelectedZoneId: (selectedZoneId) => set({ selectedZoneId }),
  setSelectedSituationId: (selectedSituationId) => set({ selectedSituationId }),
  setViewport: (viewport) => set({ viewport }),
}))
