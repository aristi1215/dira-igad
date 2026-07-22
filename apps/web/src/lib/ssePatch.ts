import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { queryKeys } from './api'
import type { AckBySituation, AckStatus, DiraSseEvent } from './types'

export type SsePatchResult = {
  patchedAck: boolean
  invalidated: QueryKey[]
}

export function applySseEvent(
  queryClient: QueryClient,
  payload: DiraSseEvent,
): SsePatchResult {
  const invalidated = invalidationKeys(payload)
  for (const queryKey of invalidated) {
    void queryClient.invalidateQueries({ queryKey })
  }

  const situationId = payload.situation_id
  const patchedAck =
    payload.ack_status === 'acknowledged' && typeof situationId === 'string'

  if (patchedAck && situationId) {
    queryClient.setQueryData<AckBySituation>(
      queryKeys.ackBySituation,
      (current = {}) => ({
        ...current,
        [situationId]: payload.ack_status ?? 'acknowledged',
      }),
    )
  }

  return { patchedAck, invalidated }
}

export function parseDiraSseEvent(value: unknown): DiraSseEvent | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    type: stringValue(value.type) as DiraSseEvent['type'],
    table: stringValue(value.table),
    op: stringValue(value.op),
    id: stringValue(value.id),
    status: stringValue(value.status),
    ack_status: ackStatusValue(value.ack_status),
    situation_id: stringValue(value.situation_id),
    alert_id: stringValue(value.alert_id),
  }
}

function invalidationKeys(payload: DiraSseEvent): QueryKey[] {
  if (payload.table === 'deliveries' || payload.type === 'delivery_updated') {
    return [queryKeys.deliveries, queryKeys.mapSituations]
  }

  if (payload.table === 'alerts' || payload.type === 'alert_updated') {
    return [queryKeys.pendingAlerts, queryKeys.deliveries]
  }

  if (payload.table === 'situations' || payload.type === 'situation_updated') {
    return [queryKeys.mapSituations]
  }

  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function ackStatusValue(value: unknown): AckStatus | undefined {
  if (
    value === 'none' ||
    value === 'acknowledged' ||
    value === 'conflict_reported' ||
    value === 'resolved'
  ) {
    return value
  }

  return undefined
}
