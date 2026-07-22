import type {
  Alert,
  AlertDraftResponse,
  ApproveAlertResponse,
  Delivery,
  RetryDeliveryResponse,
  SituationFeatureCollection,
} from './types'

/** API base URL for the FastAPI backend. */
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'http://localhost:8000'

export const queryKeys = {
  mapSituations: ['map', 'situations'] as const,
  pendingAlerts: ['alerts', 'pending_approval'] as const,
  deliveries: ['deliveries'] as const,
  ackBySituation: ['map', 'ackBySituation'] as const,
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: JsonBody
}

type JsonBody = Record<string, string | number | boolean | null>

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    throw new ApiError(await responseErrorMessage(response), response.status)
  }

  return (await response.json()) as T
}

async function responseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    const body: unknown = await response.json()
    if (isErrorDetail(body)) {
      return body.detail
    }
  }

  const text = await response.text()
  return text || `Request failed with status ${response.status}`
}

function isErrorDetail(value: unknown): value is { detail: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'detail' in value &&
    typeof value.detail === 'string'
  )
}

export function fetchMapSituations(): Promise<SituationFeatureCollection> {
  return requestJson<SituationFeatureCollection>('/map/situations')
}

export async function fetchPendingAlerts(): Promise<Alert[]> {
  try {
    return await requestJson<Alert[]>('/alerts?status=pending_approval')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return []
    }

    throw error
  }
}

export function fetchDeliveries(): Promise<Delivery[]> {
  return requestJson<Delivery[]>('/deliveries')
}

export async function prepareAlert(situationId: string): Promise<Alert> {
  const response = await requestJson<AlertDraftResponse>(
    `/situations/${situationId}/alert`,
    {
      method: 'POST',
      body: {
        created_by: 'demo-advisor',
        language: 'sw',
      },
    },
  )

  return {
    ...response,
    situation_id: situationId,
    created_by: 'demo-advisor',
    approved_by: null,
    approved_at: null,
    updated_at: null,
  }
}

export function approveAlert(alertId: string): Promise<ApproveAlertResponse> {
  return requestJson<ApproveAlertResponse>(`/alerts/${alertId}/approve`, {
    method: 'POST',
    body: {
      approved_by: 'demo-advisor',
    },
  })
}

export function retryDelivery(deliveryId: string): Promise<RetryDeliveryResponse> {
  return requestJson<RetryDeliveryResponse>(`/deliveries/${deliveryId}/retry`, {
    method: 'POST',
    body: {},
  })
}
