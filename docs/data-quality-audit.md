# RoofIQ Data Quality Audit

**Date:** 2026-09-10
**Dataset:** 30 zones, ~4,400 leads (Oklahoma City, Edmond, Nichols Hills, Luther)
**Source app:** Base44 `RoofIQ` (`6a9f85552fba8482b6a0e371`)

The lead data drives the door-knock route directly, so defects in it cost reps
time in the field. Four classes of defect were found.

## 1. Duplicate parcels

The same physical property appears more than once as separate stops in the same
zone, with different `rank` and `stop` values. A rep walking the route knocks the
same door twice.

Zone 03 (53 stops) contained six duplicate pairs — roughly 11% of the route:

| Address | Stops | Ranks |
| --- | --- | --- |
| 11521 CREST PL | 3, 20 | 421, 503 |
| 11605 CREST PL | 4, 19 | 498, 463 |
| 11221 OAKLEAF LN | 18, 28 | 174, 82 |
| 2109 NE 115TH ST | 33, 34 | 30, 31 |
| 11724 SILVERLEAF LN | 36, 37 | 9, 8 |
| 2700 NE 120TH ST | 49, 50 | 3, 2 |

Note that two of the top three globally ranked leads (ranks 2 and 3) are the same
parcel — same owner, same lat/lon.

**Resolution:** duplicates are detected by normalized address or by lat/lon
proximity (~15 m). The lowest-rank record is kept canonical; the rest are marked
`is_duplicate = true` with `duplicate_of` pointing at the canonical record.
Nothing is deleted, so the decision stays reversible.

## 2. Junk addresses ranked as live leads

17 leads carry the literal address string `"Unavailable"`. One of them held
**global rank 5**, meaning it sat near the top of the launch list despite being
unknockable.

**Resolution (applied):** all 17 set to `data_flag = "missing_address"` and
`disposition = "wrong_address"` so they drop out of routes.

## 3. Null `zone_number` and `city`

Both fields are defined in the schema but were never populated:

- `Zone.zone_number` — null on all 30 zones
- `Zone.city` — null on all 30 zones
- `Lead.zone_number` — null on all ~4,400 leads

This forces every consumer to re-parse the `"Zone 07 · Oklahoma City"` label
string to sort or group, and makes numeric zone sorting unreliable.

**Resolution (applied):** all 30 `Zone` records now carry `zone_number` and
`city`, and all ~4,400 `Lead` records carry `zone_number`. Verified complete — no
record in either entity has a null in these fields. The Data Health page repeats
this backfill by parsing the number out of the zone label, so future storm loads
are covered without manual work.

## 4. Inefficient walking order

`stop` order does not follow geography. In Zone 03 the route runs Crest Pl
(stops 2–4) → Eastern Ave (5–7) → Oakleaf Ln (8–10) → Goldleaf Ln (11–12) →
Oakleaf (13) → Silverleaf (14) → Oakleaf (15–16) → Goldleaf (17) → Oakleaf (18)
→ back to Crest Pl (19–20). The route crosses its own path repeatedly.

Stop order also ignores lead value: stop 1 is rank 536, while ranks 2 and 3 sit
at stops 49 and 50 — the best doors are knocked last, when the rep is most tired
and most likely to run out of daylight.

**Resolution:** "Optimize walking order" re-sequences each zone by
nearest-neighbour over lat/lon, seeded from the highest-value lead.

## Field-workflow data: entirely unused

Before these changes, across ~4,400 leads:

- `disposition` — 0 records set
- `roof_sqft` / `roof_squares` — 0 measured
- `Permit` table — 0 rows, so `permit_status` was blank everywhere

The schema supported the full rep workflow, but no part of it was reachable from
the UI. That gap is what the rep workflow, measurement and permit upgrades close.
