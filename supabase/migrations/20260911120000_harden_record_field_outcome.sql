-- record_field_outcome() is SECURITY DEFINER, so it bypasses RLS on properties
-- and has to reproduce that table's access rule by hand. It checked org and
-- non-viewer but never assignment, while properties_org_update requires
--
--   organization_id = current_org_id()
--   AND (current_role() in ('owner','admin','manager') OR assigned_to = auth.uid())
--
-- so routing the field app's writes through this function would have given
-- every rep write access to every lead in the organisation -- a wider grant
-- than the table's own policy, reachable by any signed-in rep calling the RPC
-- directly. This adds the missing assignment check.
--
-- The guard is gated on current_org_id() being non-null, matching the tenancy
-- check already in the function: a service/postgres caller has no org and no
-- role and stays trusted, exactly as before.

create or replace function public.record_field_outcome(
  p_property_id uuid, p_code text, p_note text default null, p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid; v_caller_org uuid; v_role text; v_tax record;
  v_now timestamptz := now(); v_prev text; v_key text; v_refined int := 0;
  v_assigned uuid;
begin
  select organization_id, lead_status::text, assigned_to
    into v_org, v_prev, v_assigned
  from properties where id = p_property_id;
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_property');
  end if;

  -- SECURITY DEFINER bypasses RLS, so tenancy has to be checked by hand.
  -- current_org_id() is null in a service/postgres context, which is trusted;
  -- for a signed-in caller it must match the property's org.
  v_caller_org := private.current_org_id();
  if v_caller_org is not null and v_caller_org <> v_org then
    return jsonb_build_object('ok', false, 'error', 'wrong_organization');
  end if;

  v_role := private."current_role"();
  if v_role = 'viewer' then
    return jsonb_build_object('ok', false, 'error', 'viewer_cannot_record_outcomes');
  end if;

  -- Mirror properties_org_update: a rep may only disposition their own leads.
  if v_caller_org is not null
     and coalesce(v_role, '') not in ('owner', 'admin', 'manager')
     and v_assigned is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_assigned_to_you');
  end if;

  select code, target, training_label, outcome_weight, lead_status_map
    into v_tax
  from ml_outcome_taxonomy where code = p_code and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_outcome_code', 'code', p_code);
  end if;
  if v_tax.lead_status_map is null then
    return jsonb_build_object('ok', false, 'error', 'code_has_no_status_mapping', 'code', p_code);
  end if;

  -- Setting lead_status is the write. private.capture_status_learning_outcome()
  -- fires on it and owns creating the ml_outcomes row and its feature vector;
  -- never insert one here or the label is counted twice.
  update properties
     set lead_status = v_tax.lead_status_map::lead_status,
         status_updated_at = v_now,
         status_updated_by = coalesce(p_actor_id, auth.uid(), status_updated_by),
         last_activity_at  = v_now
   where id = p_property_id;

  update lead_assignments
     set status = v_tax.lead_status_map::lead_status, updated_at = v_now
   where property_id = p_property_id and organization_id = v_org;

  -- The trigger records a coarse type ('lost'). The field taxonomy is finer
  -- ('recent_roof' weighs -0.90, 'not_interested' -0.35), so refine the row it
  -- just wrote rather than adding a competing one.
  if v_tax.target is not null then
    v_key := concat('status:', p_property_id, ':', v_tax.target, ':',
                    v_tax.lead_status_map, ':', extract(epoch from v_now)::bigint);
    update ml_outcomes
       set outcome_type = v_tax.code,
           outcome_value = v_tax.outcome_weight,
           source = 'field_console',
           metadata = metadata || jsonb_build_object('field_code', v_tax.code, 'note', p_note)
     where organization_id = v_org and outcome_key = v_key;
    get diagnostics v_refined = row_count;
  end if;

  insert into activities (organization_id, property_id, actor_id, activity_type, summary, details, occurred_at)
  values (v_org, p_property_id, coalesce(p_actor_id, auth.uid()), 'disposition',
          'Field disposition: ' || p_code,
          jsonb_build_object('code', p_code, 'note', p_note, 'previous_status', v_prev,
                             'new_status', v_tax.lead_status_map, 'target', v_tax.target,
                             'label', v_tax.training_label, 'source', 'field_console'),
          v_now);

  return jsonb_build_object(
    'ok', true, 'code', v_tax.code, 'previous_status', v_prev,
    'lead_status', v_tax.lead_status_map, 'target', v_tax.target,
    'label', v_tax.training_label, 'training_row', v_refined > 0, 'observed_at', v_now);
end $function$;
