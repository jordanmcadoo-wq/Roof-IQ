/** Mirrors public.rep_route_leads (see supabase/migrations). */
export type RouteLead = {
  property_id: string
  zone_name: string
  stop_order: number | null
  band: string | null
  rank_score: number | null
  top300: boolean | null
  zone_city: string | null
  territory_id: string | null
  lat: number | null
  lon: number | null
  organization_id: string
  property_address: string | null
  owner_name: string | null
  mailing_address: string | null
  market_value: number | null
  year_built: number | null
  building_area: number | null
  owner_occupied: boolean | null
  lead_status: LeadStatus | null
  lead_priority: 'low' | 'medium' | 'high' | 'critical' | null
  assigned_to: string | null
  contact_name: string | null
  contact_phone: string | null
  last_contacted_at: string | null
  has_recent_roof_permit: boolean | null
  roof_age_estimate: number | null
  sales_priority_band: string | null
  sales_action_timing: string | null
  sales_evidence_quality: string | null
  lead_value_estimate: number | null
  strongest_hail_inches: number | null
  strongest_wind_mph: number | null
  latest_storm_at: string | null
  storm_event_count: number | null
  storm_confidence: string | null
  storm_score: number | null
}

/** public.lead_status enum, verbatim. */
export type LeadStatus =
  | 'new' | 'researching' | 'assigned' | 'route_ready' | 'knocked'
  | 'contact_made' | 'inspection_scheduled' | 'inspection_complete'
  | 'estimate_sent' | 'contract_signed' | 'not_qualified' | 'closed'
  | 'attempted' | 'contacted' | 'inspection_set' | 'claim_filed'
  | 'estimate' | 'sold' | 'lost' | 'do_not_contact'

export type Profile = {
  id: string
  organization_id: string
  display_name: string | null
  role: string | null
  email: string | null
}

/** The subset a rep sets at the door, in the order they'd reach for them. */
/**
 * A door outcome as the database defines it, from ml_outcome_taxonomy.
 *
 * Rows flagged field_visible are the ones a rep may file, ordered by
 * field_order. The weight and training_label travel with the code so the UI
 * can show a rep what a given answer teaches the model.
 */
export type FieldOutcome = {
  code: string
  category: 'positive' | 'neutral' | 'negative'
  description: string | null
  outcome_weight: string | number | null
  training_label: number | null
  target: string | null
  field_order: number | null
}

/** Shape returned by public.ml_learning_health(). */
export type LearningHealth = {
  targets: Record<string, {
    labels: number
    positives: number
    negatives: number
    ready_for_training: boolean
    models: { version?: string; status?: string; algorithm?: string }[]
  }>
  total_outcomes: number
  properties_with_predictions?: number
  recommendation_feedback_count?: number
  mode?: string
}

/** A code turns into a button label without a second list to keep in sync. */
export function outcomeLabel(code: string): string {
  const words = code.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function outcomeTone(category: FieldOutcome['category']): Tone {
  if (category === 'positive') return 'go'
  if (category === 'negative') return 'act'
  return 'neutral'
}

export type Tone = 'go' | 'act' | 'neutral' | 'muted'

/** A property found by search, from public.properties directly. */
export type PropertyHit = {
  id: string
  property_address: string | null
  city: string | null
  owner_name: string | null
  mailing_address: string | null
  market_value: number | null
  lead_status: LeadStatus | null
  sales_priority_band: string | null
  sales_rank_score: number | null
  sales_action_timing: string | null
  has_recent_roof_permit: boolean | null
  latest_storm_at: string | null
  assigned_to: string | null
}

/** What the scoring model concluded about one property. */
export type AiInsight = {
  summary: string | null
  next_action: string | null
  rationale: string | null
  confidence: number | null
  opportunity_level: string | null
  cautions: unknown
  generated_at: string | null
}

export type Opportunity = {
  id: string
  stage: string | null
  probability: number | null
  estimated_contract_value: number | null
  next_action_type: string | null
  next_action_at: string | null
  appointment_at: string | null
  inspection_at: string | null
  property_id: string
}

export type LeadTask = {
  id: string
  property_id: string
  title: string | null
  description: string | null
  due_at: string | null
  priority: string | null
  status: string | null
}

export type Activity = {
  id: string
  activity_type: string | null
  summary: string | null
  occurred_at: string | null
}

/** One qualifying hail event at a property, from public.property_hail_events. */
export type HailEvent = {
  event_date: string
  source: string
  size_inches: number | null
  distance_miles: number | null
  detection_count: number | null
}

/** MRMS radar-grid detail: the precise half of the evidence. */
export type MrmsDetail = {
  latest_event_at: string | null
  max_mesh_inches: number | null
  strongest_threshold_inches: number | null
  direct_intersection: boolean | null
  distance_to_swath_miles: number | null
  qualifying_swath_count: number | null
  corroborated_report_count: number | null
  confidence_label: string | null
  accumulation_minutes: number | null
  source_freshness: string | null
}

export type WindExposure = {
  event_date: string | null
  wind_speed_mph: number | null
  distance_miles: number | null
  days_since: number | null
  event_count: number | null
}
