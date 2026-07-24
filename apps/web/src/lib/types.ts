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

// ---------------------------------------------------------------------------
// Information layer
// ---------------------------------------------------------------------------

export type ZoneContext = {
  zone_id: string
  zone_name: string
  cluster_id: string
  country_iso2: string
  ipc_phase: number | null
  pop_phase3_plus: number | null
  ipc_period_start: string | null
  idps: number | null
  refugees: number | null
  displacement_date: string | null
  staple_pct_vs_3m_avg: number | null
  staple_commodity: string | null
  active_hazards: number | null
  active_health_alerts: number | null
  verified_field_reports_recent: number | null
  unverified_field_reports_recent: number | null
}

export type ZoneSummary = ZoneContext & {
  cluster_name: string
  population: number | null
  pastoralist_share: number | null
  water_points: number | null
  markets: number | null
  operational_band: OperationalBand | null
  model_risk: number | null
  situation_id: string | null
}

export type RegionalIndicatorProperties = ZoneContext & {
  incidents_180d: number | null
  fatalities_180d: number | null
  operational_band: OperationalBand | null
  model_risk: number | null
  situation_id: string | null
}

export type RegionalIndicators = FeatureCollection<
  Geometry,
  RegionalIndicatorProperties
>

export type ClimateRow = {
  dekad_start: string
  rain_mm: number | null
  ndvi_mean: number | null
}

export type IncidentMonth = {
  month: string
  events: number
  fatalities: number
}

export type FoodSecurityRow = {
  period_start: string
  period_end: string
  ipc_phase: number
  pop_phase3_plus: number | null
  source: string
}

export type DisplacementRow = {
  snapshot_date: string
  idps: number
  refugees: number
  returnees: number
  source: string
}

export type MarketPriceRow = {
  market_name: string
  month: string
  commodity: string
  unit: string
  price: number
  currency: string
  pct_vs_3m_avg: number | null
}

export type HealthRow = {
  week_start: string
  disease: string
  cases: number
  deaths: number
  status: 'monitoring' | 'alert' | 'outbreak' | 'closed'
}

export type HazardBulletin = {
  id: string
  hazard_type: 'locust' | 'flood' | 'heat' | 'drought'
  severity: 'advisory' | 'watch' | 'warning'
  headline: string
  detail: string | null
  valid_from: string
  valid_to: string | null
  source: string
}

export type FieldReportStatus = 'unverified' | 'verified' | 'dismissed'

export type FieldReport = {
  id: string
  zone_id?: string
  zone_name?: string
  country_iso2?: string
  reporter_role: string
  category: string
  severity: number
  narrative: string
  reported_at: string
  status: FieldReportStatus
  verified_by: string | null
  verified_at: string | null
}

export type AcledEventRow = {
  event_date: string
  event_type: string
  fatalities: number
  notes: string | null
}

export type Recipient = {
  id: string
  name: string
  phone_e164: string
  zone_id: string
  zone_name?: string
  channel: string
  language: string
  active: boolean
}

export type ZoneProfile = {
  zone: {
    id: string
    name: string
    country_iso2: string
    cluster_id: string
    cluster_name: string
    geometry: Geometry
    lon: number
    lat: number
  }
  exposure: {
    population: number
    pastoralist_share: number | null
    water_points: number | null
    markets: number | null
    source: string
  } | null
  climate: ClimateRow[]
  incidents_monthly: IncidentMonth[]
  recent_events: AcledEventRow[]
  food_security: FoodSecurityRow[]
  displacement: DisplacementRow[]
  market_prices: MarketPriceRow[]
  health: HealthRow[]
  hazard_bulletins: HazardBulletin[]
  field_reports: FieldReport[]
  news_signals: ZoneSignal[]
  situation: Record<string, JsonValue> | null
  recipients: Recipient[]
}

export type SituationDetail = {
  situation: {
    id: string
    zone_id: string
    hazard: string
    status: string
    opened_cycle: string | null
    resolved_cycle: string | null
    created_at: string
  }
  assessments: {
    id: string
    cycle: string
    model_risk: number
    model_band: OperationalBand
    corroboration: number
    operational_band: OperationalBand
    combination_rule: string
    explanation: string | null
    shap: ShapBreakdown
    exposure_snapshot: ExposureSnapshot
    prob_conflict: number
    expected_incidents: number
    created_at: string
  }[]
}

export type DataSource = {
  key: string
  name: string
  category: string
  mode: 'live' | 'seeded'
  live_capable: boolean
  live_endpoint: string
  licence: string
  cadence: string
  rows: number | null
  freshest_available_at: string | null
}

export type SourcesResponse = {
  data_mode: string
  bitemporal_note: string
  sources: DataSource[]
}

export type AnalyticsOverview = {
  band_distribution: { band: string; zones: number }[]
  incidents_monthly: IncidentMonth[]
  climate_by_cluster: {
    cluster_id: string
    dekad_start: string
    rain_mm: number | null
    ndvi_mean: number | null
  }[]
  food_security_by_country: {
    country_iso2: string
    pop_phase3_plus: number | null
    worst_ipc_phase: number | null
  }[]
  displacement_by_country: {
    country_iso2: string
    idps: number | null
    refugees: number | null
  }[]
  field_report_stats: { verified: number; unverified: number; dismissed: number }
  delivery_stats: { total: number; acked: number; needs_review: number }
}

export type MapOverlay =
  | 'pressure'
  | 'ipc'
  | 'displacement'
  | 'incidents'
  | 'hazards'
