import { create } from 'zustand'
import type { AdvisorCitation, AdvisorProposal } from '../../lib/types'

export type AdvisorTurn = {
  role: 'user' | 'assistant'
  text: string
  citations?: AdvisorCitation[]
  tools?: string[]
  proposals?: AdvisorProposal[]
}

type AdvisorState = {
  open: boolean
  turns: AdvisorTurn[]
  conversationId: string | null
  /**
   * A question queued by an "explain this" affordance elsewhere in the app.
   * The drawer consumes it on open and clears it, so re-opening later does not
   * silently re-ask a question about a screen the user has since left.
   */
  seededQuestion: string | null

  openAdvisor: () => void
  closeAdvisor: () => void
  toggleAdvisor: () => void
  /** Open the drawer already asking something specific. */
  askAbout: (question: string) => void
  consumeSeed: () => string | null

  addTurn: (turn: AdvisorTurn) => void
  /** Append streamed text onto the last assistant turn. */
  appendToLast: (text: string) => void
  finishLast: (patch: Partial<AdvisorTurn>) => void
  addProposalToLast: (proposal: AdvisorProposal) => void
  dismissProposal: (proposal: AdvisorProposal) => void
  setConversationId: (id: string) => void
  reset: () => void
}

/**
 * The advisor transcript lives here rather than in the component.
 *
 * `Sheet` unmounts its children on close, so a transcript held in component
 * state was silently discarded every time the drawer was dismissed — you could
 * not close the panel to look at the map the answer was about and come back.
 */
export const useAdvisorStore = create<AdvisorState>((set, get) => ({
  open: false,
  turns: [],
  conversationId: null,
  seededQuestion: null,

  openAdvisor: () => set({ open: true }),
  closeAdvisor: () => set({ open: false }),
  toggleAdvisor: () => set((state) => ({ open: !state.open })),

  askAbout: (question) => set({ open: true, seededQuestion: question }),
  consumeSeed: () => {
    const seed = get().seededQuestion
    if (seed) set({ seededQuestion: null })
    return seed
  },

  addTurn: (turn) => set((state) => ({ turns: [...state.turns, turn] })),

  appendToLast: (text) =>
    set((state) => {
      const turns = [...state.turns]
      const last = turns[turns.length - 1]
      if (!last || last.role !== 'assistant') return state
      turns[turns.length - 1] = { ...last, text: last.text + text }
      return { turns }
    }),

  finishLast: (patch) =>
    set((state) => {
      const turns = [...state.turns]
      const last = turns[turns.length - 1]
      if (!last || last.role !== 'assistant') return state
      turns[turns.length - 1] = { ...last, ...patch }
      return { turns }
    }),

  addProposalToLast: (proposal) =>
    set((state) => {
      const turns = [...state.turns]
      const last = turns[turns.length - 1]
      if (!last || last.role !== 'assistant') return state
      turns[turns.length - 1] = {
        ...last,
        proposals: [...(last.proposals ?? []), proposal],
      }
      return { turns }
    }),

  dismissProposal: (proposal) =>
    set((state) => ({
      turns: state.turns.map((turn) => ({
        ...turn,
        proposals: turn.proposals?.filter(
          (candidate) =>
            candidate.type !== proposal.type ||
            candidate.report_id !== proposal.report_id ||
            candidate.situation_id !== proposal.situation_id,
        ),
      })),
    })),

  setConversationId: (conversationId) => set({ conversationId }),

  reset: () => set({ turns: [], conversationId: null }),
}))
