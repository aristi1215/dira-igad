import { describe, expect, it, vi } from 'vitest'

import { applyDiraEvent, patchDeliveries } from './sse'
import type { Delivery, DiraEvent } from './types'

const base: Delivery[] = [
  { id: 'd1', status: 'queued', ack_status: 'none', ack_method: null, attempts: 0, provider_message_id: null, recipient_name: 'A', phone: '+254700000001' },
  { id: 'd2', status: 'sending', ack_status: 'none', ack_method: null, attempts: 1, provider_message_id: 'p2', recipient_name: 'B', phone: '+254700000002' },
]

describe('patchDeliveries', () => {
  it('updates only the matching delivery status (delivery_updated event)', () => {
    const event: DiraEvent = { type: 'delivery', id: 'd2', status: 'delivered' }
    const next = patchDeliveries(base, event)
    expect(next.find((d) => d.id === 'd2')?.status).toBe('delivered')
    expect(next.find((d) => d.id === 'd1')?.status).toBe('queued') // untouched
    expect(base[1].status).toBe('sending') // input not mutated
  })

  it('ignores non-delivery events', () => {
    const event: DiraEvent = { type: 'assessment', id: 'a1', band: 'red' }
    expect(patchDeliveries(base, event)).toEqual(base)
  })

  it('ignores delivery events without a status', () => {
    const event: DiraEvent = { type: 'delivery', id: 'd1' }
    expect(patchDeliveries(base, event)).toEqual(base)
  })
})

describe('applyDiraEvent', () => {
  it('patches the deliveries cache and invalidates the map', () => {
    const setQueriesData = vi.fn()
    const invalidateQueries = vi.fn()
    const qc = { setQueriesData, invalidateQueries } as unknown as import('@tanstack/react-query').QueryClient
    applyDiraEvent(qc, { type: 'delivery', id: 'd2', status: 'delivered' })
    expect(setQueriesData).toHaveBeenCalledWith({ queryKey: ['deliveries'] }, expect.any(Function))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['map'] })
  })
})
