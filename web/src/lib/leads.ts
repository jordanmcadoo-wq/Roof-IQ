import { supabase } from '@/lib/supabase'
import type { LeadStatus, RouteLead } from '@/lib/types'

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
