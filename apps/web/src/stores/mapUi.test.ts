import { describe, expect, it } from 'vitest'

import { useMapUiStore } from './mapUi'

describe('mapUi store', () => {
  it('holds only client view state — never server data', () => {
    const state = useMapUiStore.getState() as unknown as Record<string, unknown>
    const keys = Object.keys(state).filter((k) => typeof state[k] !== 'function')
    // The store must contain ONLY selection / layers / viewport — no situations, deliveries,
    // assessments, or any server-owned collection.
    expect(keys.sort()).toEqual(['activeLayers', 'selectedSituationId', 'viewport'])
  })

  it('updates selection', () => {
    useMapUiStore.getState().setSelectedSituationId('sit-1')
    expect(useMapUiStore.getState().selectedSituationId).toBe('sit-1')
  })
})
