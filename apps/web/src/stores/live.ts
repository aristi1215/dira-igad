import { create } from 'zustand'

const FLASH_MS = 1_000

type LiveState = {
  /** Ids that changed within the flash window. */
  touched: Record<string, true>
  markTouched: (id: string) => void
}

/**
 * Records which rows just changed over SSE, so a row can flash once to say
 * "this moved" without the viewer having to diff the screen themselves.
 *
 * The store expires its own entries on a timer rather than storing timestamps
 * and comparing against `Date.now()` at render time — reading the clock during
 * render is impure, and it would also leave rows stuck in the flashed state
 * until something else re-rendered them.
 *
 * A one-shot flash on change only. A situation room that blinks continuously
 * trains people to ignore it.
 */
export const useLiveStore = create<LiveState>((set) => ({
  touched: {},
  markTouched: (id) => {
    set((state) => (state.touched[id] ? state : { touched: { ...state.touched, [id]: true } }))
    setTimeout(() => {
      set((state) => {
        if (!state.touched[id]) return state
        const next = { ...state.touched }
        delete next[id]
        return { touched: next }
      })
    }, FLASH_MS)
  },
}))

/** True while `id` is inside its flash window. */
export function useJustUpdated(id: string | null | undefined): boolean {
  return useLiveStore((state) => (id ? state.touched[id] === true : false))
}
