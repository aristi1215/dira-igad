/** Minimal UI store: active layers, selection, viewport. Server truth stays in Query. */
import { create } from 'zustand'

type MapUiState = {
  activeLayers: string[]
  selectedZoneId: string | null
  setActiveLayers: (layers: string[]) => void
  setSelectedZoneId: (id: string | null) => void
}

export const useMapUiStore = create<MapUiState>((set) => ({
  activeLayers: ['rain', 'vegetation'],
  selectedZoneId: null,
  setActiveLayers: (activeLayers) => set({ activeLayers }),
  setSelectedZoneId: (selectedZoneId) => set({ selectedZoneId }),
}))
