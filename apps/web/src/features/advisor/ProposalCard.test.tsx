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

  it('shows the drafted body text, editable, before the operator can dispatch', () => {
    const markup = renderToStaticMarkup(
      <ProposalCard
        proposal={{
          type: 'dispatch',
          situation_id: 'situation-1',
          channel: 'voice',
          phone_numbers: ['+254700000001'],
          language: 'sw',
          body_text: 'Tahadhari: ukame unaongeza presha kwenye maji na malisho.',
          zone_name: 'Mandera East',
        }}
        onDismiss={vi.fn()}
      />,
    )

    expect(markup).toContain('Mandera East')
    expect(markup).toContain('Tahadhari: ukame unaongeza presha kwenye maji na malisho.')
    expect(markup).toContain('Alert message (edit before sending)')
    // Dispatch stays gated on a non-empty operator name regardless of the
    // drafted text being present — the drafted body is not itself consent.
    expect(markup).toContain('Operator name required to dispatch')
    expect(markup).toContain('disabled')
  })

  it('shows drafted text read-only on an alert-draft proposal (no dispatch gate)', () => {
    const markup = renderToStaticMarkup(
      <ProposalCard
        proposal={{
          type: 'alert-draft',
          situation_id: 'situation-1',
          language: 'sw',
          body_text: 'Tahadhari: ukame unaongeza presha kwenye maji na malisho.',
          zone_name: 'Mandera East',
        }}
        onDismiss={vi.fn()}
      />,
    )

    expect(markup).toContain('Drafted alert message')
    expect(markup).toContain('Tahadhari: ukame unaongeza presha kwenye maji na malisho.')
    expect(markup).toContain('readOnly')
  })
})
