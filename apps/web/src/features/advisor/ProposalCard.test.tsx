import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProposalCard } from './ProposalCard'

const { advisorDispatch } = vi.hoisted(() => ({ advisorDispatch: vi.fn() }))

vi.mock('../../lib/api', () => ({
  advisorDispatch,
  prepareAlert: vi.fn(),
  verifyFieldReport: vi.fn(),
}))

describe('ProposalCard dispatch proposal', () => {
  it('requires a named operator and a valid target number', () => {
    const markup = renderToStaticMarkup(
      <ProposalCard
        proposal={{
          type: 'dispatch',
          situation_id: 'situation-1',
          channel: 'voice',
          phone_numbers: ['+254700000001'],
          language: 'sw',
        }}
        onDismiss={vi.fn()}
      />,
    )

    expect(markup).toContain('Dispatch alert · human-gated')
    expect(markup).toContain('Place a voice call')
    expect(markup).toContain('Operator name required to dispatch')
    expect(markup).toContain('disabled')
    expect(markup).toContain('+254700000001')
  })
})
