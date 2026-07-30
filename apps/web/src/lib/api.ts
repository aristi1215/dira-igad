import type {
  AdvisorCitation,
  AdvisorResponse,
  Alert,
  AlertDraftResponse,
  AnalyticsOverview,
  ApproveAlertResponse,
  Delivery,
  EconomyResponse,
  FieldReport,
  MapEvents,
  HazardCollection,
  ModelCard,
  Recipient,
  RegionalIndicators,
  RetryDeliveryResponse,
  SituationDetail,
  SituationFeatureCollection,
  SourcesResponse,
  ZoneProfile,
  ZoneSignal,
  ZoneSummary,
  ZoneTrends,
} from './types'

/** API base URL for the FastAPI backend. */
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'http://localhost:8000'

export const queryKeys = {
  mapSituations: ['map', 'situations'] as const,
  pendingAlerts: ['alerts', 'pending_approval'] as const,
  allAlerts: ['alerts', 'all'] as const,
  deliveries: ['deliveries'] as const,
  ackBySituation: ['map', 'ackBySituation'] as const,
  economy: ['economy'] as const,
  zoneSignals: (zoneId: string) => ['zones', zoneId, 'signals'] as const,
  zones: ['zones'] as const,
  zoneProfile: (zoneId: string) => ['zones', zoneId, 'profile'] as const,
  regionalIndicators: ['indicators', 'regional'] as const,
  mapEvents: ['map', 'events'] as const,
  hazards: ['hazards'] as const,
  mapTrends: ['map', 'trends'] as const,
  situationDetail: (id: string) => ['situations', id] as const,
  fieldReports: (zoneId?: string | null, status?: string | null) =>
    ['field-reports', zoneId ?? 'all', status ?? 'all'] as const,
  sources: ['sources'] as const,
  analytics: ['analytics', 'overview'] as const,
  recipients: ['recipients'] as const,
  modelCard: ['model', 'card'] as const,
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

export function approveAlert(
  alertId: string,
  approvedBy: string,
): Promise<ApproveAlertResponse> {
  return requestJson<ApproveAlertResponse>(`/alerts/${alertId}/approve`, {
    method: 'POST',
    body: {
      approved_by: approvedBy,
    },
  })
}

export function fetchEconomy(): Promise<EconomyResponse> {
  return requestJson<EconomyResponse>('/economy')
}

export function fetchZoneSignals(zoneId: string): Promise<ZoneSignal[]> {
  return requestJson<ZoneSignal[]>(`/zones/${zoneId}/signals`)
}

export function askAdvisor(
  question: string,
  situationId: string | null,
  options?: { zoneId?: string | null; conversationId?: string | null },
): Promise<AdvisorResponse> {
  return requestJson<AdvisorResponse>('/advisor', {
    method: 'POST',
    body: {
      question,
      situation_id: situationId,
      zone_id: options?.zoneId ?? null,
      conversation_id: options?.conversationId ?? null,
    },
  })
}

/** Events the advisor stream emits, in the order they arrive. */
export type AdvisorStreamHandlers = {
  /** A retrieval tool finished. Fires once per tool, in real execution order. */
  onTool?: (name: string) => void
  onConversation?: (conversationId: string) => void
  /** A slice of the answer. One call when the provider cannot stream. */
  onDelta?: (text: string) => void
  onDone?: (payload: { citations?: AdvisorCitation[]; tools_used?: string[] }) => void
  onError?: (message: string) => void
}

/**
 * Ask the advisor over SSE.
 *
 * `EventSource` cannot POST, and the question does not belong in a query
 * string, so this reads the body stream directly and parses the SSE framing.
 * The parser keeps a buffer because a chunk boundary can land anywhere —
 * including mid-event — and splitting naively drops text.
 */
export async function streamAdvisor(
  question: string,
  situationId: string | null,
  options: {
    zoneId?: string | null
    conversationId?: string | null
    signal?: AbortSignal
  } & AdvisorStreamHandlers = {},
): Promise<void> {
  const response = await fetch(apiUrl('/advisor/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      question,
      situation_id: situationId,
      zone_id: options.zoneId ?? null,
      conversation_id: options.conversationId ?? null,
    }),
  })

  if (!response.ok || !response.body) {
    throw new ApiError(`Advisor stream failed (${response.status})`, response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (raw: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) return

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
    } catch {
      return
    }

    switch (event) {
      case 'tool':
        if (typeof payload.name === 'string') options.onTool?.(payload.name)
        break
      case 'conversation':
        if (typeof payload.conversation_id === 'string') {
          options.onConversation?.(payload.conversation_id)
        }
        break
      case 'delta':
        if (typeof payload.text === 'string') options.onDelta?.(payload.text)
        break
      case 'done':
        options.onDone?.(payload as Parameters<NonNullable<typeof options.onDone>>[0])
        break
      case 'error':
        options.onError?.(
          typeof payload.message === 'string' ? payload.message : 'Advisor failed.',
        )
        break
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE events are separated by a blank line; anything after the last one is
    // an incomplete event and must stay buffered.
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const raw of events) {
      if (raw.trim()) dispatch(raw)
    }
  }
  if (buffer.trim()) dispatch(buffer)
}

export function fetchModelCard(): Promise<ModelCard> {
  return requestJson<ModelCard>('/model/card')
}

export function retryDelivery(deliveryId: string): Promise<RetryDeliveryResponse> {
  return requestJson<RetryDeliveryResponse>(`/deliveries/${deliveryId}/retry`, {
    method: 'POST',
    body: {},
  })
}

// ---------------------------------------------------------------------------
// Information layer
// ---------------------------------------------------------------------------

export function fetchZones(): Promise<ZoneSummary[]> {
  return requestJson<ZoneSummary[]>('/zones')
}

export function fetchZoneProfile(zoneId: string): Promise<ZoneProfile> {
  return requestJson<ZoneProfile>(`/zones/${zoneId}/profile`)
}

export function fetchRegionalIndicators(): Promise<RegionalIndicators> {
  return requestJson<RegionalIndicators>('/indicators/regional')
}

/** Individual conflict events. The map's heat field is kernel density over these. */
export function fetchMapEvents(days = 180): Promise<MapEvents> {
  return requestJson<MapEvents>(`/map/events?days=${days}`)
}

export function fetchHazards(): Promise<HazardCollection> {
  return requestJson<HazardCollection>('/hazards')
}

/** Recent risk history per zone, oldest first — the badge sparklines. */
export function fetchMapTrends(cycles = 6): Promise<ZoneTrends> {
  return requestJson<ZoneTrends>(`/map/trends?cycles=${cycles}`)
}

export function fetchSituationDetail(id: string): Promise<SituationDetail> {
  return requestJson<SituationDetail>(`/situations/${id}`)
}

export function fetchAllAlerts(): Promise<Alert[]> {
  return requestJson<Alert[]>('/alerts')
}

export function fetchFieldReports(
  zoneId?: string | null,
  status?: string | null,
): Promise<FieldReport[]> {
  const params = new URLSearchParams()
  if (zoneId) params.set('zone_id', zoneId)
  if (status) params.set('status', status)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return requestJson<FieldReport[]>(`/field-reports${suffix}`)
}

export function createFieldReport(input: {
  zone_id: string
  reporter_role: string
  category: string
  severity: number
  narrative: string
}): Promise<FieldReport> {
  return requestJson<FieldReport>('/field-reports', { method: 'POST', body: input })
}

export function verifyFieldReport(
  reportId: string,
  verifiedBy: string,
): Promise<FieldReport> {
  return requestJson<FieldReport>(`/field-reports/${reportId}/verify`, {
    method: 'POST',
    body: { verified_by: verifiedBy },
  })
}

export function dismissFieldReport(
  reportId: string,
  verifiedBy: string,
): Promise<FieldReport> {
  return requestJson<FieldReport>(`/field-reports/${reportId}/dismiss`, {
    method: 'POST',
    body: { verified_by: verifiedBy },
  })
}

export function fetchSources(): Promise<SourcesResponse> {
  return requestJson<SourcesResponse>('/sources')
}

export function fetchAnalytics(): Promise<AnalyticsOverview> {
  return requestJson<AnalyticsOverview>('/analytics/overview')
}

export function fetchRecipients(): Promise<Recipient[]> {
  return requestJson<Recipient[]>('/recipients')
}
