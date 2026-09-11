import { supabase } from '@/lib/supabase'
import type {
  Activity, AiInsight, HailEvent, LeadStatus, LeadTask, MrmsDetail, Opportunity,
  PropertyHit, RouteLead, WindExposure,
} from '@/lib/types'

const LEAD_COLUMNS =
  'property_id, zone_name, stop_order, band, rank_score, top300, zone_city, territory_id,' +
  'lat, lon, organization_id, property_address, owner_name, mailing_address, market_value,' +
  'year_built, building_area, owner_occupied, lead_status, lead_priority, assigned_to,' +
  'contact_name, contact_phone, last_contacted_at, has_recent_roof_permit, roof_age_estimate,' +
  'sales_priority_band, sales_action_timing, sales_evidence_quality, lead_value_estimate,' +
  'strongest_hail_inches, strongest_wind_mph, latest_storm_at, storm_event_count,' +
  'storm_confidence, storm_score'

/**
 * PostgREST caps a response at 1000 rows by default and the biggest zone is
 * well past that, so page until the server stops handing back full pages.
 */
export async function fetchAllLeads(): Promise<RouteLead[]> {
  const page = 1000
  const out: RouteLead[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('rep_route_leads')
      .select(LEAD_COLUMNS)
      .order('zone_name')
      .order('stop_order')
      .range(from, from + page - 1)
    if (error) throw new Error(humanise(error.message))
    const batch = (data ?? []) as unknown as RouteLead[]
    out.push(...batch)
    if (batch.length < page) return out
  }
}

export async function fetchZoneLeads(zoneName: string): Promise<RouteLead[]> {
  const { data, error } = await supabase
    .from('rep_route_leads')
    .select(LEAD_COLUMNS)
    .eq('zone_name', zoneName)
    .order('stop_order')
    .limit(1000)
  if (error) throw new Error(humanise(error.message))
  return (data ?? []) as unknown as RouteLead[]
}

export type DispositionInput = {
  lead: RouteLead
  status: LeadStatus
  note?: string
  actorId: string
}

/**
 * Record a door outcome.
 *
 * Two writes, deliberately not wrapped in a transaction: the status on
 * properties is what the route reads, and the activities row is the audit
 * trail. If the audit insert fails we still keep the status change rather than
 * making the rep knock again, and surface the partial failure.
 */
export async function recordDisposition({
  lead, status, note, actorId,
}: DispositionInput): Promise<{ warning?: string }> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('properties')
    .update({
      lead_status: status,
      last_contacted_at: now,
      status_updated_at: now,
      status_updated_by: actorId,
      last_activity_at: now,
    })
    .eq('id', lead.property_id)
    .select('id')

  if (error) throw new Error(humanise(error.message))

  // RLS denials are not errors - the update simply matches no rows. Without
  // this check the rep sees a success toast for a write that never landed.
  if (!data || data.length === 0) {
    throw new Error(
      'That lead is not assigned to you, so the update was refused. ' +
        'Ask a manager to assign it or to change it for you.',
    )
  }

  const { error: actErr } = await supabase.from('activities').insert({
    organization_id: lead.organization_id,
    property_id: lead.property_id,
    actor_id: actorId,
    activity_type: 'door_knock',
    summary: `Door outcome: ${status.replace(/_/g, ' ')}`,
    details: {
      status,
      note: note ?? null,
      zone: lead.zone_name,
      stop_order: lead.stop_order,
      band: lead.band,
      source: 'field-app',
    },
    occurred_at: now,
  })

  return actErr
    ? { warning: 'Outcome saved, but the activity log entry failed.' }
    : {}
}

function humanise(message: string): string {
  if (/rep_route_leads/.test(message) && /does not exist|schema cache/i.test(message)) {
    return (
      'The rep_route_leads view is missing. Apply ' +
      'supabase/migrations/20260911000000_rep_route_leads_view.sql to the database.'
    )
  }
  return message
}

const PROPERTY_COLUMNS =
  'id, property_address, city, owner_name, mailing_address, market_value, lead_status,' +
  'sales_priority_band, sales_rank_score, sales_action_timing, has_recent_roof_permit,' +
  'latest_storm_at, assigned_to'

/**
 * Search every property in the org, not just the launch cut.
 *
 * This is the thing the Base44 extract structurally cannot do: it holds one
 * frozen 4,797-row slice, while `properties` carries the whole scored book. A
 * rep standing on a street that was not in the cut can still look the address
 * up here.
 */
export async function searchProperties(term: string): Promise<PropertyHit[]> {
  // PostgREST parses or() as a comma-separated list and treats ()., specially,
  // so those characters have to go before the term is interpolated - 602 of
  // these addresses contain a comma, and a rep typing "123 Main St, OKC" would
  // otherwise send a malformed filter. % and _ are escaped so they stay literal
  // rather than acting as LIKE wildcards.
  const q = term.trim().replace(/[(),.]/g, ' ').replace(/\s+/g, ' ').trim()
  if (q.length < 3) return []
  const pattern = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`

  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_COLUMNS)
    // normalized_address is what the pipeline matches on; property_address is
    // what a rep reads off a mailbox. Search both so either spelling lands.
    .or(`property_address.ilike.${pattern},normalized_address.ilike.${pattern},owner_name.ilike.${pattern}`)
    .order('sales_rank_score', { ascending: false, nullsFirst: false })
    .limit(60)

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as PropertyHit[]
}

export async function fetchProperty(propertyId: string): Promise<PropertyHit | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_COLUMNS + ', year_built, roof_age_estimate, roof_type, roof_condition, building_area, owner_occupied, contact_phone, contact_name, lead_value_estimate, sales_evidence_quality, last_contacted_at')
    .eq('id', propertyId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as unknown as PropertyHit | null
}

export async function fetchStormSummary(propertyId: string) {
  const { data } = await supabase
    .from('property_storm_summary')
    .select('strongest_hail_inches, strongest_wind_mph, latest_storm_at, storm_event_count, storm_confidence, storm_score, nearest_verified_report_miles')
    .eq('property_id', propertyId)
    .maybeSingle()
  return data
}

export async function fetchInsight(propertyId: string): Promise<AiInsight | null> {
  const { data } = await supabase
    .from('property_ai_insights')
    .select('summary, next_action, rationale, confidence, opportunity_level, cautions, generated_at')
    .eq('property_id', propertyId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data ?? null) as AiInsight | null
}

export async function fetchActivities(propertyId: string): Promise<Activity[]> {
  const { data } = await supabase
    .from('activities')
    .select('id, activity_type, summary, occurred_at')
    .eq('property_id', propertyId)
    .order('occurred_at', { ascending: false })
    .limit(20)
  return (data ?? []) as Activity[]
}

/** Opportunities and tasks with a date attached, soonest first. */
export async function fetchFollowups(): Promise<{
  opportunities: (Opportunity & { address?: string | null })[]
  tasks: (LeadTask & { address?: string | null })[]
}> {
  const [opps, tasks] = await Promise.all([
    supabase
      .from('opportunities')
      .select('id, property_id, stage, probability, estimated_contract_value, next_action_type, next_action_at, appointment_at, inspection_at')
      .or('next_action_at.not.is.null,appointment_at.not.is.null')
      .order('next_action_at', { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from('lead_tasks')
      .select('id, property_id, title, description, due_at, priority, status')
      .neq('status', 'completed')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(100),
  ])

  const ids = [
    ...(opps.data ?? []).map((o) => o.property_id),
    ...(tasks.data ?? []).map((t) => t.property_id),
  ].filter(Boolean)

  const addresses = new Map<string, string | null>()
  if (ids.length) {
    const { data } = await supabase
      .from('properties')
      .select('id, property_address')
      .in('id', [...new Set(ids)])
    for (const p of data ?? []) addresses.set(p.id as string, p.property_address as string | null)
  }

  return {
    opportunities: (opps.data ?? []).map((o) => ({
      ...(o as unknown as Opportunity),
      address: addresses.get(o.property_id as string) ?? null,
    })),
    tasks: (tasks.data ?? []).map((t) => ({
      ...(t as unknown as LeadTask),
      address: addresses.get(t.property_id as string) ?? null,
    })),
  }
}

/**
 * Every qualifying hail event at a property, newest first.
 *
 * Two sources with materially different precision, and the UI must not blur
 * them: MRMS is a radar grid product, so a hit means the swath covered this
 * parcel. SWDI is storm-cell attribution within roughly two miles, which the
 * scoring model already discounts. Showing source and distance per event lets
 * a rep judge the evidence instead of trusting one blended number.
 */
export async function fetchHailEvents(propertyId: string): Promise<HailEvent[]> {
  const { data, error } = await supabase
    .from('property_hail_events')
    .select('event_date, source, size_inches, distance_miles, detection_count')
    .eq('property_id', propertyId)
    .order('event_date', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as HailEvent[]
}

export async function fetchMrmsDetail(propertyId: string): Promise<MrmsDetail | null> {
  const { data } = await supabase
    .from('property_mrms_hail_summary')
    .select('latest_event_at, max_mesh_inches, strongest_threshold_inches, direct_intersection, distance_to_swath_miles, qualifying_swath_count, corroborated_report_count, confidence_label, accumulation_minutes, source_freshness')
    .eq('property_id', propertyId)
    .maybeSingle()
  return (data ?? null) as MrmsDetail | null
}

export async function fetchWindExposure(propertyId: string): Promise<WindExposure | null> {
  const { data } = await supabase
    .from('property_wind_exposure')
    .select('event_date, wind_speed_mph, distance_miles, days_since, event_count')
    .eq('property_id', propertyId)
    .maybeSingle()
  return (data ?? null) as WindExposure | null
}
