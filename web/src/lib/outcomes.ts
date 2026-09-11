import { supabase } from '@/lib/supabase'
import type { FieldOutcome, LearningHealth, RouteLead } from '@/lib/types'

/**
 * The outcome buttons a rep sees are defined in the database, not here.
 *
 * ml_outcome_taxonomy carries field_visible and field_order precisely so the
 * field console renders the codes the model is trained on, in the order the
 * model owner chose. Hardcoding a list in the client is how the two drift:
 * a code gets retired or reweighted server-side and reps keep filing it.
 */
export async function fetchFieldOutcomes(): Promise<FieldOutcome[]> {
  const { data, error } = await supabase
    .from('ml_outcome_taxonomy')
    .select('code, category, description, outcome_weight, training_label, target, field_order')
    .eq('active', true)
    .eq('field_visible', true)
    .order('field_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as FieldOutcome[]
}

export type FieldOutcomeResult = {
  ok: boolean
  error?: string
  code?: string
  target?: string | null
  label?: number | null
  /** True when this knock refined a real training row rather than only a status. */
  training_row?: boolean
  lead_status?: string
}

/**
 * Record a door outcome through record_field_outcome().
 *
 * The previous path wrote properties.lead_status directly. That still fires
 * the learning trigger, but the trigger only knows the coarse status, so
 * "recent roof, replaced last year" and "I got the renter" both landed as
 * not_qualified with the same weight. They are not the same signal: the first
 * says the model was wrong about roof age, the second says nothing about the
 * roof at all. Training on that conflation actively degrades the model.
 *
 * The RPC maps a fine-grained code to its status, lets the trigger build the
 * feature vector, then refines that row with the code and its weight.
 */
export async function recordFieldOutcome(args: {
  lead: Pick<RouteLead, 'property_id'>
  code: string
  note?: string
  actorId: string
}): Promise<FieldOutcomeResult> {
  const { data, error } = await supabase.rpc('record_field_outcome', {
    p_property_id: args.lead.property_id,
    p_code: args.code,
    p_note: args.note?.trim() ? args.note.trim() : null,
    p_actor_id: args.actorId,
  })
  if (error) throw new Error(error.message)

  const result = (data ?? {}) as FieldOutcomeResult
  if (!result.ok) throw new Error(explain(result.error))
  return result
}

/**
 * The RPC reports refusals as {ok:false, error:code} rather than raising, so
 * without this a rep would see a raw identifier or, worse, a success toast.
 */
function explain(code?: string): string {
  switch (code) {
    case 'not_assigned_to_you':
      return 'That lead is not assigned to you. Ask a manager to assign it or to log it for you.'
    case 'wrong_organization':
      return 'That lead belongs to another organisation.'
    case 'viewer_cannot_record_outcomes':
      return 'Your account is read-only, so outcomes cannot be logged.'
    case 'unknown_property':
      return 'That property no longer exists.'
    case 'unknown_outcome_code':
      return 'That outcome was retired. Reload the app to get the current list.'
    case 'code_has_no_status_mapping':
      return 'That outcome is not configured for field use. Tell a manager.'
    default:
      return code ? `The outcome was refused (${code}).` : 'The outcome was refused.'
  }
}

export async function fetchLearningHealth(): Promise<LearningHealth> {
  const { data, error } = await supabase.rpc('ml_learning_health')
  if (error) throw new Error(error.message)
  return (data ?? { targets: {}, total_outcomes: 0 }) as LearningHealth
}
