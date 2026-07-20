/** TanStack Query hooks. Server truth lives here (never in Zustand). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export function useSituations(pollMs: number | false) {
  return useQuery({
    queryKey: ['map'],
    queryFn: api.mapSituations,
    refetchInterval: pollMs, // backup polling only when SSE is down
  })
}

export function useSituationDetail(situationId: string | null) {
  return useQuery({
    queryKey: ['situation', situationId],
    queryFn: () => api.situationDetail(situationId as string),
    enabled: situationId !== null,
  })
}

export function useDeliveries(alertId: string | null) {
  return useQuery({
    queryKey: ['deliveries', alertId],
    queryFn: () => api.deliveries(alertId as string),
    enabled: alertId !== null,
  })
}

export function useCreateDraft() {
  return useMutation({
    mutationFn: (situationId: string) => api.createDraft(situationId),
  })
}

export function useApprove() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ alertId, approvedBy }: { alertId: string; approvedBy: string }) =>
      api.approve(alertId, approvedBy),
    onSuccess: (_data, { alertId }) => {
      void qc.invalidateQueries({ queryKey: ['deliveries', alertId] })
    },
  })
}

export function useRetryDelivery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (deliveryId: string) => api.retryDelivery(deliveryId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deliveries'] })
    },
  })
}
