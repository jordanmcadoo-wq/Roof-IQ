# The outcome learning loop

## What was wrong

The scoring audit (`docs/scoring-audit.md`) found the v5 model structurally
sound and limited by data, with zero outcome data as the hard blocker: without
labels there is nothing to calibrate constants against.

The database already had the entire loop built:

| Object | Purpose | State before this change |
|---|---|---|
| `ml_outcome_taxonomy` | 21 outcome codes, 9 flagged `field_visible` with `field_order` | populated, unused by the app |
| `private.capture_status_learning_outcome()` | trigger on `properties`, writes `ml_outcomes` with a feature vector | enabled, rarely reached |
| `public.record_field_outcome()` | maps a field code to a status, refines the trigger's row | granted to `authenticated`, never called |
| `public.ml_learning_health()` | label counts and training readiness per target | granted, never called |

The field app never called any of it. It wrote `properties.lead_status`
directly, with six hardcoded statuses.

### The label-noise bug

Writing the status directly *does* fire the trigger, so it was not that no rows
could ever appear. The defect is subtler and worse: the trigger only sees the
coarse status. Every one of these collapses to `not_qualified`:

- `recent_roof` — roof replaced last year (taxonomy weight **-0.90**)
- `renter` — talked to a tenant, not the owner (**-0.20**)
- `bad_property_data` — the record is wrong (**-1.00**)

They are not the same signal. `recent_roof` says the model was wrong about roof
age and should down-weight this property. `renter` says nothing about the roof
at all — it is a contact problem, and the house may still be an excellent lead.
Training on the conflation teaches the model that correctly-identified damaged
roofs are bad leads. That is worse than having no labels.

## What changed

The field console now calls `record_field_outcome()` with the taxonomy's own
codes, rendered from `ml_outcome_taxonomy` ordered by `field_order` rather than
hardcoded in the client. The RPC maps the code to its status, lets the trigger
build the feature vector, then refines that row with the fine-grained code and
its calibrated weight.

Verified end to end against live data in a rolled-back transaction: filing
`recent_roof` produced `target=sold_90d`, `label=0`, `outcome_type=recent_roof`,
`outcome_value=-0.90`, `source=field_console` and a **39-key feature snapshot**
captured at the moment of the knock. That snapshot is what keeps later
calibration honest — the features are frozen as they were when the rep stood at
the door, not re-derived after the model has changed.

The old `recordDisposition()` was deleted rather than left in place. A second
write path that bypasses the taxonomy is how this bug comes back.

## Security fix, applied first

`record_field_outcome()` is `SECURITY DEFINER`, so it bypasses RLS and must
reproduce the table's access rule itself. It checked organisation and
non-viewer, but never assignment. `properties_org_update` requires:

```
organization_id = current_org_id()
AND (current_role() IN ('owner','admin','manager') OR assigned_to = auth.uid())
```

Routing the app's writes through the RPC as written would have given every rep
write access to every lead in the organisation — a wider grant than the table's
own policy, and reachable by any signed-in rep calling the RPC directly, app or
not. Migration `20260911120000_harden_record_field_outcome.sql` adds the missing
assignment check, gated on `current_org_id()` being non-null so the
service/postgres path stays trusted exactly as before.

Verified both directions, in rolled-back transactions, by impersonating a rep:

- rep + unassigned lead → `{"ok":false,"error":"not_assigned_to_you"}`
- rep + assigned lead → `{"ok":true,"target":"inspection_set_30d","label":1,"training_row":true}`

No rep accounts exist yet (three owners and one viewer), so this currently
changes nothing in practice. It matters the moment Status Roofing staff get rep
logins.

## Reading progress

`/learning` renders `ml_learning_health()`. A target is trainable at **250
labels with at least 50 positives and 50 negatives** — that rule lives in the
SQL function, and the screen mirrors it rather than defining its own, so the two
disagree visibly instead of the screen quietly lying.

The negative codes are not bookkeeping. A file of nothing but wins teaches the
model that every house is a win; the 50-negative floor is what forces enough
contrast to separate a good door from a bad one.

## What this does not do

It does not retune any scoring constant. It makes retuning *possible* later by
producing labels that mean something. Until a target clears its thresholds the
model stays in `shadow_until_validated`, which is where it should stay.
