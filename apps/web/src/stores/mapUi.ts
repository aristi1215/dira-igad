/** Minimal UI store: active layers, selection, viewport. Server truth stays in Query.
 * INVARIANT: this store holds NO server data — only client-side view state. */
import { create } from 'zustand'

interface Viewport {
  center: [number, number]
  zoom: number
}

interface MapUiState {
  activeLayers: string[]
  selectedSituationId: string | null
  viewport: Viewport
  setActiveLayers: (layers: string[]) => void
  setSelectedSituationId: (id: string | null) => void
  setViewport: (v: Viewport) => void
}

export const useMapUiStore = create<MapUiState>((set) => ({
  activeLayers: ['rain', 'ndvi'],
  selectedSituationId: null,
  viewport: { center: [41.9, 3.95], zoom: 7.4 },
  setActiveLayers: (activeLayers) => set({ activeLayers }),
  setSelectedSituationId: (selectedSituationId) => set({ selectedSituationId }),
  setViewport: (viewport) => set({ viewport }),
}))
