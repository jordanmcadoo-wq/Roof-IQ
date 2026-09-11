# RoofIQ Upgrades — September 2026

Four upgrade areas, applied to the Base44 app `RoofIQ`
(`6a9f85552fba8482b6a0e371`).

## Where the code lives

This repository does not contain the RoofIQ application source. The app is built
and hosted on Base44, whose source remote is Base44's own S3 storage rather than
GitHub. On the free tier, Base44's direct file and shell access
(`sandbox-bridge`) is unavailable, so application changes are made through the
Base44 builder and the entity APIs, not through commits here.

This directory therefore mirrors *what changed and why*, so the work is reviewable
and reproducible. It is documentation, not the running code.

## 1. Data quality

See [data-quality-audit.md](./data-quality-audit.md) for the full findings.

Summary of defects: duplicate parcels routed as separate doors (~11% of Zone 03),
17 leads with an `"Unavailable"` address (one at global rank 5), `zone_number` and
`city` null across the dataset, and a walking order that ignores both geography
and lead value.

The null `zone_number` / `city` backfill and the junk-address flagging are fully
applied to the live dataset. Duplicate detection is delivered as a **Data Health**
admin page that scans all leads, reports counts, and applies fixes behind a
confirmation step. Detection is non-destructive —
duplicates are flagged, never deleted.

Every route, list, map and dashboard figure in the app now excludes leads where
`is_duplicate` is true or `data_flag` is `"missing_address"`.

## 2. Rep field workflow

The schema already modelled dispositions, assignment and notes, but nothing in the
UI wrote to them — 0 of ~4,400 leads had a disposition set.

- **My Route** — pick a zone, work its stops as large touch targets showing stop
  number, address, owner, band, hail size, market value and claim days left.
  Phone-first, usable one-handed while walking.
- **One-tap dispositions** — writing the existing enum, and also setting
  `last_contacted_at` and incrementing `contact_attempts`.
- **Scheduling** — `appointment_set` / `inspection_scheduled` prompt for
  `appointment_at`; `callback` prompts for `callback_at`.
- **Notes and assignment** — `rep_notes` and `assigned_to`.
- **Navigate** — opens the address in Google Maps.
- **Optimize walking order** — nearest-neighbour re-sequencing of `stop` over
  lat/lon, seeded from the highest-value lead in the zone.
- **Follow-ups** — callbacks due and upcoming appointments by date, overdue
  highlighted.

## 3. Manager dashboard and claim urgency

A hail lead is worth nothing once the insurance claim window shuts, so the
deadline is treated as the organising principle rather than a column.

- Headline tiles: live leads, A1 count, pipeline value, doors knocked, contact
  rate, appointments set, sold.
- **Claim deadline buckets** from `claim_days_left`: Critical (<30 days), Urgent
  (30–90), Watch (90–180), Fine (180+), with an alert naming the zones about to
  expire and a jump straight to those leads.
- Zone leaderboard: zone, city, leads, A1, pipeline value, avg damage index, min
  claim days left, percent worked — sortable, click through to the route.
- Rep activity: doors knocked, contacts, appointments, sales and conversion rate
  per `assigned_to`.
- Charts for disposition breakdown and pipeline value by zone.

## 4. Roof measurement and permit matching

- **Measurement** — draw the roof outline on a satellite map; footprint area is
  computed from the polygon and multiplied by the selected `roof_pitch` to get
  true roof area. Saves `roof_polygon`, `roof_sqft`, `roof_squares` and
  `measured_at`, and shows an estimated job value so a rep can quote on the
  doorstep.
- **Permits** — the `Permit` table was empty, leaving `permit_status` blank on
  every lead. Added a Permits page plus a matcher that compares normalized
  addresses and sets `permit_status` to `recent_reroof` (roofing permit issued
  after `storm_date`), `older_roof_permit`, `other_permit` or `no_permit`, and
  stamps `permit_checked_at`.
- Leads matching `recent_reroof` are marked **skip this door** in the route — the
  roof has already been replaced, so the visit is wasted.

## Schema changes

Added to the `Lead` entity:

| Field | Type | Purpose |
| --- | --- | --- |
| `is_duplicate` | boolean | Duplicate parcel, excluded from routes |
| `duplicate_of` | string | Id of the canonical lead |
| `data_flag` | enum | `missing_address`, `duplicate_parcel`, `bad_geo` |
| `contact_attempts` | number | Times the door has been knocked |
| `appointment_at` | date-time | Scheduled appointment / inspection |
| `callback_at` | date-time | When to follow up |
| `roof_polygon` | array | Rep-drawn roof outline as lat/lon vertices |
| `roof_pitch` | enum | Pitch used to convert footprint to true roof area |

No existing fields were removed or retyped, and no lead records were deleted.
