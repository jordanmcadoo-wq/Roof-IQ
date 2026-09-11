# Scoring audit — 2026-09-11

An audit of the v5 model against a request to "increase, tighten and harden" it.
The short version: **the model is sound and every term is live. What limits lead
quality is data coverage, and one change was made — a timeout fix.** No scoring
constants were retuned, for a reason set out below.

## The model is not the problem

`roofiq_model_contract` declares 14 terms and asserts each must vary in the
shadow output. All 12 `required_active` terms pass:

| Term | Observed | Verdict |
| --- | --- | --- |
| `damage_score` | 36,999 distinct, 2.03–18.95 | live |
| `hail_energy_d4` | 38,170 distinct, 0–35.15 | live |
| `hail_distance_attenuation` | 1,992 distinct, 0.75–1.00 | live |
| `hail_radar_dwell` | 12 distinct, 1.00–1.45 | live |
| `multi_storm_best_event` | 22 distinct, 1.06–3.75" | live |
| `close_score` | 11 distinct, 0.005–0.85 | live |
| `claim_window` | 20 distinct, 16–665 days | live |
| `evidence_confidence` | 24 distinct, 0.325–0.590 | live, but see the ceiling |

The two `dormant_by_design` terms are honestly labelled and both are data
problems, not modelling ones.

This is a well-instrumented model. The contract table, the shadow/baseline
challenger pattern, and a self-check every 20 minutes are all things most
systems this size do not have.

## The binding constraint: confidence is capped at 0.59

Confidence is the product of three factors:

```
conf = evidence_conf × roof_conf × assessor_conf
```

and it feeds empirical-Bayes shrinkage:

```
damage = raw_estimate × conf + population_mean × (1 − conf)
```

Measured across the property book:

| Factor | Value in practice | Why |
| --- | --- | --- |
| `roof_conf` | **0.72** for 87,251 of 87,399 | No roof age. `year_built` is present on **24 records (0.03%)**, `roof_age_estimate` on 148, proxy on 6. |
| `assessor_conf` | **0.82** for 86,293 | Every record was verified 30–90 days ago. |
| `evidence_conf` | 0.55–0.65 typical | SWDI-dominant evidence. |

`0.72 × 0.82 = 0.59` — that is the observed maximum confidence in the shadow
table, and it is a hard ceiling no storm evidence can lift.

**Roughly 40–67% of every property's damage score is the population average.**
The ranking is heavily compressed toward the mean, and no change to the hail
physics can widen it while `roof_conf` sits at 0.72.

The dormant `roof_age_multiplier` would swing damage by up to
`1 + 0.045 × 25 = 2.125×`. It is the largest single lever in the model and it is
switched off for 99.8% of properties.

### A timed degradation nobody is watching

`assessor_conf` steps down with age: 1.00 within 7 days, 0.92 to 30, 0.82 to 90,
then **0.70**. Every property was verified between 2026-07-22 and 2026-09-04, and
`assessor_arcgis_incremental` has been failing since 2026-09-04.

From roughly **2026-10-20** the oldest records begin crossing 90 days and
confidence drops 0.82 → 0.70 — a further ~15% shrinkage toward the mean, applied
silently, to every score. Nothing currently alerts on this.

## Can permits revive roof age? No — checked

`permit_records` holds 1,863 roof-eligible permits, and only 154 are matched to a
property. That looks like a matching bug worth fixing. It is not:

- All 1,709 unmatched permits carry a normalized address.
- Exact match against `properties.normalized_address`: **0**.
- After stripping the trailing ` OK <zip>` the permit feed appends: still **0**.
- Spot-checking the streets — ROHAN RD, CANTON TRL, BELMONTE, NW 40TH ST — none
  exist in the property inventory at all.

The permits are **city-wide** (73099 Yukon, 73105 central, 73170 far south) while
the property inventory is a **north-metro subset**. The matcher's own reason,
`property_inventory_missing_or_no_safe_candidate`, is literally correct.

Two consequences:

1. Roof age cannot be derived this way. The permit window is 2026-04-29 to
   2026-08-25 anyway — four months — which dates recent re-roofs, not roof age.
2. The re-roof disqualifier is blind outside the north metro. Reps can be routed
   to houses that were re-roofed this summer, in any part of the city the
   assessor inventory does not cover.

Both resolve by widening the assessor inventory, which is the failing
`assessor_arcgis_incremental` job, which is gated behind the storage limit in
[pipeline-health.md](./pipeline-health.md).

## Why no constants were retuned

There is no outcome data to calibrate against:

| Signal | Rows |
| --- | ---: |
| `ml_outcomes` | 0 |
| `ml_recommendation_feedback` | 0 |
| `contact_dispositions` | 0 |
| Won opportunities | 0 |
| `door_knock` activities | 0 |

Every constant in `scoring_parameters` is a prior. Changing
`swdi_attribution_factor`, `hail_distance_falloff` or the confidence steps
without outcomes would move the rankings without any way to tell whether they
moved toward reality. That is not tightening; it is churn with a version bump.

The project already holds this line elsewhere — `contact_confidence_weights`
carries the note *"a defensible prior, NOT measured values —
calibrated_from_outcomes stays false until contact_dispositions has enough
volume to fit them."* The same standard applies to the rest of the model.

**The field app is the instrument that ends this.** Every disposition writes
`lead_status` and a `door_knock` activity. A few hundred worked doors with
honest outcomes turns every constant here from a prior into something fittable.

## What changed

One thing, and it was a real defect rather than a tuning opinion:

```sql
alter function public.roofiq_v4_refresh_start()  set statement_timeout = '20min';
alter function public.roofiq_shadow_score_v5()   set statement_timeout = '20min';
```

`roofiq-v4-refresh-start` had been failing nightly with *"canceling statement due
to statement timeout"*. The database default is 2 minutes; scoring 87k properties
over 277k hail events in one insert does not fit.

Set on the functions rather than globally or on the `postgres` role: a
function-scoped `SET` applies only for that call and is inherited by what it
calls, so ordinary queries keep the 2-minute guard protecting the API.

**Batching was rejected.** Bands come from
`percent_rank() over (partition by organization_id order by dmg)`, and a window
function needs its whole partition. Splitting by property range would compute
percentiles within each batch and silently mis-band every lead — far worse than a
visible timeout.

## Recommended order

1. **Storage ceiling.** Nothing else moves until `pipeline_storage_guard()`
   returns `safe: true`.
2. **Assessor sync.** Fixing `assessor_arcgis_incremental` widens the inventory,
   which fixes permit matching, and stops the October confidence decay.
3. **Roof age.** The single largest modelling lever, worth up to 2.125× on
   damage, currently off for 99.8% of properties. It needs `year_built` from the
   assessor feed.
4. **Outcomes.** Work the list through the field app until there are enough
   labelled doors to fit constants instead of asserting them.
5. **Then retune** — against measured outcomes, promoting through the existing
   shadow/baseline challenger path.

## Hardening worth adding

Not implemented here, since each edits `run_roofiq_health_checks()` on a live
system, but each closes a gap this audit found:

- **Assessor decay clock** — warn when the oldest `last_verified_at` is within
  14 days of crossing a confidence step, before scores silently shrink.
- **Confidence ceiling** — alert if `max(confidence)` in the shadow table stays
  below, say, 0.75 across a full refresh. Today it is 0.59 and nothing says so.
- **Permit coverage ratio** — track matched ÷ eligible permits. It is 8% and
  reads as a healthy job because the rows that fail are simply absent.
