# Backend inventory

## The permit pipeline is already built — and it is good

It was worth checking before evaluating any vendor. The system already has a
generic permit ingestion stack, and it is better than what a per-address lookup
service would give you.

| Piece | What it does |
|---|---|
| `permit_jurisdictions` | Registry of jurisdictions, each with a portal URL, an adapter key and capability flags |
| `probe-energov-permits` | Probes a Tyler EnerGov portal, discovers the tenant, verifies search works, and self-registers the adapter |
| `sync-energov-statewide` | Pulls a date window from any EnerGov-ready jurisdiction, classifies roof work, archives raw to storage, then imports |
| `sync-okc-public-permits` | OKC's Accela feed |
| `sync-tulsa-permits` | Tulsa EnerGov |
| `import-permit-history` | The shared writer: normalises, matches, dedupes, queues rescores |
| `permit-admin`, `verify-okc-lead-permits` | Review and verification |

`import-permit-history` matches on a four-tier cascade, strongest first:

```
parcel_id (1.00) → account_number (0.99) → normalized_address (0.95) → unique_building_address (0.85)
```

It detects ambiguity (two identifiers resolving to different properties), never
overwrites a manual reviewer's decision, supports dry runs, and skips re-import
by content hash. `sync-energov-statewide` archives the raw pull to storage
*before* importing and checks `pipeline_storage_guard()` first, so when storage
is unsafe it captures the data and defers the database write rather than losing
the pull.

**Conclusion: the gap is not tooling.** A commercial permit API would replace a
better system with a worse one.

## Gap 1 — the registry points at the wrong market

| Jurisdiction | Status | Adapter | EnerGov verified |
|---|---|---|---|
| Oklahoma City | partial | `okc_accela_public_v1` | — |
| Tulsa | partial | `tyler_energov_generic_v1` | yes |
| Broken Arrow | partial | `tyler_energov_generic_v1` | yes |
| Tulsa County Unincorporated | manual | — | — |
| Moore | manual | — | — |
| Stillwater | manual | — | — |
| Edmond | planned | — | — |
| Norman | planned | — | — |

**Three of the eight are Tulsa-area** — a separate market roughly 100 miles
away, on no campaign sheet. Meanwhile **not one** of Yukon, Mustang, Chickasha,
Harrah, Choctaw, McLoud, Shawnee or Slaughterville is registered, and those are
the campaign.

This is the same shape as the property inventory and the launch cut: everything
is built for north OKC and Tulsa, while the campaign runs south and west.

Adding a jurisdiction is cheap where the city runs EnerGov — insert a row in
`permit_jurisdictions` with the portal URL, call `probe-energov-permits`, and it
self-registers. Whether each campaign city runs EnerGov, Accela or something
else has not been checked.

## Gap 2 — none of the backend is in git

**89 edge functions are deployed. Zero are version controlled.** The repository
carries `web/`, `docs/` and `supabase/migrations/` only.

That means no history, no review, no diff and no rollback for the permit
pipeline, the scoring worker, the storm ingestion and the auth functions. If
`sync-energov-statewide` is overwritten, the previous version is gone.

`scripts/sync-edge-functions.mjs` fixes this. It pulls every deployed function
into `supabase/functions/<slug>/index.ts` and writes an `INVENTORY.json`
recording version, JWT setting and last-updated time:

```sh
SUPABASE_ACCESS_TOKEN=sbp_... node scripts/sync-edge-functions.mjs
```

The token is a personal access token from the Supabase dashboard, not the anon
or service-role key. Unchanged files are skipped, so `git status` after a run
shows exactly what drifted since the last sync — worth running on a schedule,
not once.

The source could not be committed directly from the session that wrote this:
the Management API is unreachable from that sandbox, and transcribing 89
functions by hand would risk silently corrupting them. A script that fetches
them verbatim is the safe path.

## What actually limits permits

Neither gap is the binding one. **1,713 of 1,715 unmatched permits fail with
`property_inventory_missing_or_no_safe_candidate`** — the house is not in the
inventory. Only 2 fail for a genuine address-matching reason.

You hold 87,399 of Oklahoma County's 336,992 parcels, and the ArcGIS import is
paused at record 93,500 by the storage guard. Until that resumes, every new
permit source adds to the orphan pile rather than the matched one.

Order of operations: storage, then the parcel import, then jurisdictions.
