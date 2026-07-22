import type { Feature, FeatureCollection, Geometry } from 'geojson'

export type OperationalBand =
  | 'low'
  | 'watch'
  | 'elevated'
  | 'high'
  | 'very_high'

export type AlertStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'dispatching'
  | 'dispatched'
  | 'failed'

export type DeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'needs_review'

export type AckStatus =
  | 'none'
  | 'acknowledged'
  | 'conflict_reported'
  | 'resolved'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ExposureSnapshot = {
  population?: number
  pastoralist_share?: number
  water_points?: number
  markets?: number
  [key: string]: JsonValue | undefined
}

export type ShapBreakdown = Record<string, number>

export type SituationFeatureProperties = {
  situation_id: string
  zone_id: string
  hazard: string
  situation_status: 'open' | 'resolved' | 'dismissed'
  zone_name: string
  country_iso2: string
  assessment_id: string | null
  cycle: string | null
  model_risk: number | null
  model_band: OperationalBand | null
  corroboration: number | null
  operational_band: OperationalBand | null
  explanation: string | null
  combination_rule: string | null
  shap: ShapBreakdown
  exposure_snapshot: ExposureSnapshot
  prob_conflict: number | null
  expected_incidents: number | null
  acknowledged?: boolean
}

export type SituationFeature = Feature<Geometry, SituationFeatureProperties>

export type SituationFeatureCollection = FeatureCollection<
  Geometry,
  SituationFeatureProperties
>

export type Alert = {
  id: string
  situation_id: string
  status: AlertStatus
  language: string
  body_text: string
  created_by?: string | null
  approved_by?: string | null
  approved_at?: string | null
  created_at: string
  updated_at?: string | null
}

export type AlertDraftResponse = {
  id: string
  status: AlertStatus
  language: string
  body_text: string
  created_at: string
}

export type ApproveAlertResponse = {
  id: string
  status: 'approved'
  approved_by: string
}

export type Delivery = {
  id: string
  alert_id: string
  recipient_id: string
  channel: string
  status: DeliveryStatus
  ack_status: AckStatus
  attempt_count: number
  provider_message_id: string | null
  last_error: string | null
  updated_at: string
}

export type RetryDeliveryResponse = {
  id: string
  status: 'queued'
}

export type AckBySituation = Record<string, AckStatus>

export type DiraSseEvent = {
  type?: 'delivery_updated' | 'alert_updated' | 'situation_updated'
  table?: 'deliveries' | 'alerts' | 'situations' | string
  op?: 'INSERT' | 'UPDATE' | 'DELETE' | string
  id?: string
  status?: string
  ack_status?: AckStatus
  situation_id?: string
  alert_id?: string
}

export type ZoneSignal = {
  id: string
  zone_id: string
  signal_type: string
  confidence: number
  status: string
  excerpt: string | null
  cycle: string
  title: string | null
  source: string | null
  published_at: string | null
}

export type CountryEconomy = {
  name: string
  currency: string
  gdp_usd_bn: (number | null)[]
  gdp_growth_pct: (number | null)[]
  inflation_pct: (number | null)[]
  population_m: (number | null)[]
  food_insecure_m?: number
  agri_gdp_share_pct?: number
  remittances_pct_gdp?: number
  note?: string
}

export type EconomyResponse = {
  source: string
  as_of: string
  years: number[]
  countries: Record<string, CountryEconomy>
}

export type AdvisorResponse = {
  answer: string
  context: Record<string, JsonValue>
}

export type Viewport = {
  longitude: number
  latitude: number
  zoom: number
}
