/** API types mirrored from the Pydantic/SQL contracts. Strict — no `any`. */
import type { Geometry } from 'geojson'

export type OperationalBand = 'green' | 'yellow' | 'orange' | 'red'

export interface MapProperties {
  situation_id: string
  zone_id: string
  zone_name: string
  country: string
  hazard_type: string
  situation_status: string
  assessment_id: string
  cycle: string
  model_risk: number
  model_band: string
  corroboration: number
  operational_band: OperationalBand
  explanation: string
  exposed_population: number | null
  exposed_households: number | null
  acknowledged: boolean
}

export interface MapFeature {
  type: 'Feature'
  geometry: Geometry
  properties: MapProperties
}

export interface MapFeatureCollection {
  type: 'FeatureCollection'
  features: MapFeature[]
}

export interface Assessment {
  id: string
  cycle: string
  model_risk: number
  model_band: string
  prob_conflict: number
  expected_incidents: number
  corroboration: number
  operational_band: OperationalBand
  combination_rule: string
  explanation: string
  shap: Record<string, number>
}

export interface SituationDetail {
  id: string
  zone_id: string
  zone_name: string
  country: string
  hazard_type: string
  status: string
  opened_at: string
  resolved_at: string | null
  assessments: Assessment[]
}

export interface AlertDraft {
  id: string
  status: string
  draft_text: string
  language: string
}

export interface ApproveResponse {
  alert_id: string
  status: string
  deliveries_created: number
}

export type DeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'needs_review'

export interface Delivery {
  id: string
  status: DeliveryStatus
  ack_status: string
  ack_method: string | null
  attempts: number
  provider_message_id: string | null
  recipient_name: string | null
  phone: string
}

/** SSE payload relayed from pg_notify('dira_events', ...). */
export interface DiraEvent {
  type: 'delivery' | 'alert' | 'assessment'
  id: string
  status?: string
  situation_id?: string
  band?: string
  cycle?: string
}
