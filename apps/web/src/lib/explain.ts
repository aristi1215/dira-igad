import {
  Bug,
  Mountain,
  MountainSnow,
  Sun,
  Thermometer,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { OperationalBand } from './types'

/** Human-readable metadata for every model feature (SHAP driver). */
export type FeatureMeta = {
  label: string
  description: string
  group: 'climate' | 'conflict history' | 'seasonality' | 'spatial'
}

export const FEATURE_META: Record<string, FeatureMeta> = {
  rain_mm: {
    label: 'Rainfall (current dekad)',
    description:
      'CHIRPS rainfall for the assessment dekad. Low rainfall raises pressure on shared water and pasture; unusually high rainfall can enable movement and raids.',
    group: 'climate',
  },
  rain_lag1: {
    label: 'Rainfall (1 dekad ago)',
    description:
      'Rainfall in the previous dekad — captures how recently the zone last received rain.',
    group: 'climate',
  },
  rain_lag2: {
    label: 'Rainfall (2 dekads ago)',
    description:
      'Rainfall two dekads back — extends the short-term dryness memory of the model.',
    group: 'climate',
  },
  rain_anomaly: {
    label: 'Rainfall anomaly',
    description:
      'Deviation of recent rainfall from the zone’s seasonal norm. A strong negative anomaly is a classic precursor of resource competition.',
    group: 'climate',
  },
  ndvi_mean: {
    label: 'Vegetation (NDVI)',
    description:
      'MODIS vegetation greenness for the dekad — a proxy for pasture availability. Browning rangeland concentrates herds around fewer water points.',
    group: 'climate',
  },
  ndvi_lag1: {
    label: 'Vegetation (1 dekad ago)',
    description: 'Vegetation greenness in the previous dekad.',
    group: 'climate',
  },
  ndvi_anomaly: {
    label: 'Vegetation anomaly',
    description:
      'Deviation of greenness from the seasonal norm — negative anomalies indicate pasture stress beyond the usual dry-season pattern.',
    group: 'climate',
  },
  incident_count_dekad: {
    label: 'Incidents (this dekad)',
    description:
      'Conflict events recorded in the zone during the assessment dekad (ACLED-shaped). Recent violence is the strongest predictor of near-term violence.',
    group: 'conflict history',
  },
  incident_count_lag1: {
    label: 'Incidents (1 dekad ago)',
    description: 'Conflict events recorded in the previous dekad.',
    group: 'conflict history',
  },
  incident_trend: {
    label: 'Incident trend',
    description:
      'Direction of the incident series over recent dekads — an escalating trend raises the forecast even before counts get large.',
    group: 'conflict history',
  },
  neighbor_incident_mean: {
    label: 'Neighbouring-zone incidents',
    description:
      'Mean incident count across adjacent zones — conflict spills across administrative borders, especially in tri-border clusters.',
    group: 'spatial',
  },
  month_sin: {
    label: 'Seasonality (sin)',
    description:
      'Cyclical encoding of the calendar month, letting the model learn seasonal conflict patterns (e.g. dry-season migration).',
    group: 'seasonality',
  },
  month_cos: {
    label: 'Seasonality (cos)',
    description:
      'Second component of the cyclical month encoding — together with sin it places the dekad on the annual cycle.',
    group: 'seasonality',
  },
}

export function featureMeta(feature: string): FeatureMeta {
  return (
    FEATURE_META[feature] ?? {
      label: feature.replaceAll('_', ' '),
      description: 'Model feature (no curated description available).',
      group: 'conflict history',
    }
  )
}

/** Hazard bulletin metadata: icon, accent color and preparedness guidance. */
export type HazardMeta = {
  label: string
  icon: string
  color: string
  description: string
  actions: string[]
}

export const HAZARD_META: Record<string, HazardMeta> = {
  drought: {
    label: 'Drought',
    icon: '☀',
    color: '#b28600',
    description:
      'Extended rainfall deficit degrading pasture and water availability. Drought concentrates herds and people around remaining resources, raising the chance of disputes.',
    actions: [
      'Pre-position water trucking for the most affected sub-locations',
      'Convene peace committees along shared migration corridors',
      'Monitor livestock body condition and market off-take prices',
    ],
  },
  flood: {
    label: 'Flood',
    icon: '≋',
    color: '#0072c3',
    description:
      'Riverine or flash flooding risk. Floods cut roads, displace households and can strand livestock — displacement into neighbouring zones raises local pressure.',
    actions: [
      'Verify river gauge levels and evacuation routes',
      'Alert riverside settlements and health posts',
      'Pre-position boats/sandbags with county disaster teams',
    ],
  },
  heat: {
    label: 'Extreme heat',
    icon: '🌡',
    color: '#da1e28',
    description:
      'Sustained extreme temperatures stressing people, livestock and water systems, and accelerating pasture loss.',
    actions: [
      'Issue water-rationing guidance to water-point committees',
      'Extend clinic hours for heat-related illness',
      'Advise herders on night movement of livestock',
    ],
  },
  locust: {
    label: 'Desert locust',
    icon: '🦗',
    color: '#198038',
    description:
      'Desert locust swarm activity threatening crops and pasture. Sudden pasture loss can force abnormal herd movements into contested rangeland.',
    actions: [
      'Report swarm sightings to FAO DLIS with coordinates',
      'Coordinate control spraying windows with county teams',
      'Track pasture loss against migration corridors',
    ],
  },
  volcanic: {
    label: 'Volcanic activity',
    icon: '△',
    color: '#8a3ffc',
    description:
      'Elevated volcanic unrest (seismicity, degassing or eruption risk). Ashfall and exclusion zones can displace communities with little warning.',
    actions: [
      'Confirm exclusion-zone radius with the geological survey',
      'Pre-identify evacuation host sites and water sources',
      'Brief health posts on ashfall respiratory guidance',
    ],
  },
  earthquake: {
    label: 'Earthquake',
    icon: '⌁',
    color: '#6f6f6f',
    description:
      'Seismic activity or aftershock risk. Damage to water infrastructure and roads can sharply increase local resource competition.',
    actions: [
      'Inspect water points and bridges for structural damage',
      'Verify communications with remote field monitors',
      'Stage search-and-rescue assets near affected settlements',
    ],
  },
  landslide: {
    label: 'Landslide',
    icon: '⛰',
    color: '#8d6e2f',
    description:
      'Slope-failure risk, usually following heavy rain on degraded escarpments. Landslides cut roads and can isolate market access.',
    actions: [
      'Map at-risk settlements below saturated slopes',
      'Issue movement advisories for affected roads',
      'Pre-position road-clearing equipment',
    ],
  },
}

export const HAZARD_ICONS: Record<string, LucideIcon> = {
  drought: Sun,
  flood: Waves,
  heat: Thermometer,
  locust: Bug,
  volcanic: Mountain,
  earthquake: Zap,
  landslide: MountainSnow,
}

export function hazardMeta(hazardType: string): HazardMeta {
  return (
    HAZARD_META[hazardType] ?? {
      label: hazardType.replaceAll('_', ' '),
      icon: '⚠',
      color: '#525252',
      description: 'Hazard bulletin issued for this zone.',
      actions: [],
    }
  )
}

export const HAZARD_SEVERITY_META: Record<
  string,
  { label: string; tone: 'info' | 'warning' | 'error'; meaning: string }
> = {
  advisory: {
    label: 'Advisory',
    tone: 'info',
    meaning: 'Be aware — conditions could develop; no immediate action required.',
  },
  watch: {
    label: 'Watch',
    tone: 'warning',
    meaning: 'Be prepared — conditions are favourable for the hazard to occur.',
  },
  warning: {
    label: 'Warning',
    tone: 'error',
    meaning: 'Take action — the hazard is occurring or imminent.',
  },
}

/** News-signal category descriptions (LLM extraction, E3 stage). */
export const SIGNAL_TYPE_META: Record<string, string> = {
  dryness_pressure:
    'Media reporting consistent with drought/dryness stress — failed rains, pasture loss, water scarcity — that historically precedes resource competition.',
  resource_pressure:
    'Media reporting of direct competition over water, pasture or land — disputes at boreholes, blocked corridors, grazing disagreements.',
  displacement_pressure:
    'Media reporting of population movements into or out of the zone that change the local balance of people and resources.',
  tension:
    'Media reporting of inter-communal tension, hostile rhetoric or mobilisation without confirmed violence.',
  violence:
    'Media reporting of violent incidents — raids, clashes or attacks — in or near the zone.',
}

export function signalTypeMeta(signalType: string): string {
  return (
    SIGNAL_TYPE_META[signalType] ??
    'LLM-extracted pressure signal from Horn of Africa media monitoring.'
  )
}

/** Field-report category descriptions (CEWARN-style monitor taxonomy). */
export const REPORT_CATEGORY_META: Record<string, string> = {
  livestock_raid:
    'Theft or attempted theft of livestock — the most common trigger of retaliatory cycles in pastoral areas.',
  water_dispute:
    'Dispute over access to a borehole, dam or river point — an early sign of resource stress.',
  pasture_dispute:
    'Dispute over grazing land or corridor access between herding groups.',
  migration_influx:
    'Unusual arrival of herds or households from another area, changing the local resource balance.',
  market_disruption:
    'Market closure, price shock or trade-route disruption affecting household access to food.',
  road_blockage:
    'Road blocked by flooding, insecurity or protest — degrades market and humanitarian access.',
  armed_presence:
    'Sighting of armed actors or unusual weapons movement — treated with high operational weight.',
  peace_meeting:
    'Inter-communal dialogue or reconciliation meeting — a de-escalatory signal worth tracking.',
  other: 'Field observation outside the standard CEWARN category set.',
}

export function reportCategoryMeta(category: string): string {
  return (
    REPORT_CATEGORY_META[category] ??
    'Field monitor observation reported through the CEWARN network.'
  )
}

export const REPORTER_ROLE_META: Record<string, string> = {
  field_monitor: 'Trained CEWARN field monitor embedded in the community',
  peace_committee: 'Member of the local inter-communal peace committee',
  drm_officer: 'County/regional disaster risk management officer',
  chief: 'Local administrative chief or community leader',
}

/** Band thresholds — mirrors dira_core.risk._SCORE_THRESHOLDS exactly. */
export const BAND_THRESHOLDS: { min: number; band: OperationalBand }[] = [
  { min: 0.8, band: 'very_high' },
  { min: 0.65, band: 'high' },
  { min: 0.45, band: 'elevated' },
  { min: 0.25, band: 'watch' },
  { min: 0, band: 'low' },
]

/**
 * The interior band boundaries, ascending — drawn as hairlines on a Meter so a
 * score locates itself without a legend. Derived from BAND_THRESHOLDS rather
 * than restated, so the two can never disagree.
 */
export const BAND_TICKS: number[] = BAND_THRESHOLDS.map(({ min }) => min)
  .filter((min) => min > 0)
  .sort((a, b) => a - b)

export function bandFromScore(score: number): OperationalBand {
  const s = Math.max(0, Math.min(1, score))
  for (const { min, band } of BAND_THRESHOLDS) {
    if (s >= min) return band
  }
  return 'low'
}

export type CombinationBreakdown = {
  newsCorroboration: number | null
  fieldCorroboration: number | null
  operationalScore: number
  preBumpBand: OperationalBand
  bumped: boolean
}

/**
 * Reconstruct the two corroboration channels from the persisted rule text
 * (e.g. "corroboration=max(news 0.72, verified_field_reports 0.50)") and
 * recompute the weighted score with the same constants the backend uses.
 */
export function parseCombination(
  rule: string | null | undefined,
  modelRisk: number,
  corroboration: number,
): CombinationBreakdown {
  let news: number | null = null
  let field: number | null = null
  const match = rule?.match(
    /max\(news ([0-9.]+), verified_field_reports ([0-9.]+)\)/,
  )
  if (match) {
    news = Number(match[1])
    field = Number(match[2])
  }
  const operationalScore = 0.7 * modelRisk + 0.3 * corroboration
  const preBumpBand = bandFromScore(operationalScore)
  const bumped = Boolean(rule?.includes('corroboration_bump'))
  return {
    newsCorroboration: news,
    fieldCorroboration: field,
    operationalScore,
    preBumpBand,
    bumped,
  }
}
