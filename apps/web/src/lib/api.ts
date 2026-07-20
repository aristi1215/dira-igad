/** Typed API client for the FastAPI backend. */
import type {
  AlertDraft,
  ApproveResponse,
  Delivery,
  MapFeatureCollection,
  SituationDetail,
} from './types'

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return (await res.json()) as T
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  mapSituations: () => getJSON<MapFeatureCollection>('/map/situations'),
  situationDetail: (id: string) => getJSON<SituationDetail>(`/situations/${id}`),
  deliveries: (alertId: string) => getJSON<Delivery[]>(`/alerts/${alertId}/deliveries`),
  needsReview: () => getJSON<Delivery[]>('/deliveries/needs-review'),
  createDraft: (situationId: string, language = 'sw') =>
    postJSON<AlertDraft>(`/situations/${situationId}/alert`, { language }),
  approve: (alertId: string, approvedBy: string) =>
    postJSON<ApproveResponse>(`/alerts/${alertId}/approve`, { approved_by: approvedBy }),
  retryDelivery: (deliveryId: string) =>
    postJSON<{ id: string; status: string }>(`/deliveries/${deliveryId}/retry`, {}),
}
