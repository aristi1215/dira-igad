import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from './api'
import { applySseEvent } from './ssePatch'
import type { AckBySituation } from './types'

describe('applySseEvent', () => {
  it('patches acknowledged delivery status by situation id', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<AckBySituation>(queryKeys.ackBySituation, {
      'existing-situation': 'none',
    })

    const result = applySseEvent(queryClient, {
      type: 'delivery_updated',
      table: 'deliveries',
      id: 'delivery-1',
      situation_id: 'situation-1',
      ack_status: 'acknowledged',
      status: 'delivered',
    })

    expect(result.patchedAck).toBe(true)
    expect(queryClient.getQueryData(queryKeys.ackBySituation)).toEqual({
      'existing-situation': 'none',
      'situation-1': 'acknowledged',
    })
    expect(result.invalidated).toEqual([
      queryKeys.deliveries,
      queryKeys.mapSituations,
    ])
  })

  it('does not patch ack cache without an acknowledged situation event', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<AckBySituation>(queryKeys.ackBySituation, {})

    const result = applySseEvent(queryClient, {
      table: 'deliveries',
      id: 'delivery-2',
      ack_status: 'none',
      status: 'sent',
    })

    expect(result.patchedAck).toBe(false)
    expect(queryClient.getQueryData(queryKeys.ackBySituation)).toEqual({})
    expect(result.invalidated).toEqual([
      queryKeys.deliveries,
      queryKeys.mapSituations,
    ])
  })

  it('invalidates pending alerts when alert events arrive', () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const result = applySseEvent(queryClient, {
      table: 'alerts',
      id: 'alert-1',
      status: 'approved',
    })

    expect(result).toEqual({
      patchedAck: false,
      invalidated: [queryKeys.pendingAlerts, queryKeys.deliveries],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.pendingAlerts,
    })
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.deliveries,
    })
  })
})
