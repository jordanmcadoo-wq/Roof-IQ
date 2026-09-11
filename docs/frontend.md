# RoofIQ field front end

A React front end for roofing reps working doors, reading directly from the
`roofiq-ai` Supabase project. It lives in [`web/`](../web).

## Why this exists

The Base44 app is a field client over one extract — `okc_launch_cut`, 4,797
rows. The Supabase project behind it holds 87,399 properties, 277,469 hail
events, permit matching and the v4/v5 scoring model. This front end talks to
that database directly, so reps see the real model rather than a snapshot of it.

There is no API tier, and none is needed: row-level security on the Supabase
tables is already org-scoped, and the policies allow a rep to update only leads
assigned to them. The browser holds a publishable key, and RLS does the rest.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Build | Vite + React 18 + TypeScript (strict) | Fast, boring, no framework lock-in |
| Styling | Tailwind v4 | Design tokens in CSS, no config file to drift |
| Data | `@supabase/supabase-js` | Talks to Postgres through PostgREST |
| Hosting | Railway (container + `server.mjs`) | Deployed there today; Cloudflare Workers config is kept alongside it |

Vercel's Hobby plan is restricted to non-commercial personal use, which a
roofing sales tool is not. Cloudflare Pages carries no such restriction, which
is why it is the deploy target here.

## Setup

```bash
cd web
npm install
cp .env.example .env      # then fill in the publishable key
npm run dev
```

The publishable (anon) key is in the Supabase dashboard under
**Project Settings → API Keys**. It is designed to sit in a browser bundle —
row-level security, not key secrecy, is what protects the data. Never put the
`service_role` key in this file; it bypasses RLS entirely.

## Required database migration

The app reads a single view, `public.rep_route_leads`.

**Status: applied to `roofiq-ai` on 2026-09-11.** It returns 4,797 rows across 30
zones, every one carrying valid lat/lon. Re-apply it from
`supabase/migrations/20260911000000_rep_route_leads_view.sql` if you rebuild the
project or spin up a branch.

It exists for two concrete reasons:

1. `okc_launch_cut` has no foreign key to `properties`, so PostgREST cannot
   embed the join and the client would otherwise need N+1 round trips.
2. `geom` is a PostGIS `geography` column. Selected raw over PostgREST it
   returns EWKB hex, which is useless to a map. The view projects `st_y`/`st_x`
   into plain numeric `lat`/`lon`.

The view is declared `security_invoker = true`, so it runs as the querying user
and the existing RLS policies still apply. A view without that flag would run as
its owner and silently bypass row-level security.

Privileges end up as `authenticated: SELECT` and nothing for `anon`. The public
schema's default privileges grant `anon` full rights on any new view, so the
migration revokes them explicitly. `security_invoker` already blocks anon — it
holds no grant on `okc_launch_cut`, verified by querying the view as that role —
but the revoke means access does not depend on that chain staying intact.

## Where it is deployed

**Live on Railway:** https://web-production-60f6f.up.railway.app

| | |
| --- | --- |
| Project | `roofiq-field` |
| Service | `web` (root directory `web`) |
| Source | `jordanmcadoo-wq/Roof-IQ` |
| Runtime | Node 22, `npm start` -> `server.mjs` |

Railway runs containers rather than serving static files, so `web/server.mjs`
sits in front of the build. It is dependency-free on purpose: the job is reading
files out of `dist/` and setting headers, and a server framework would add
supply-chain surface for no benefit. It reproduces what `_headers` gives on
Cloudflare — the same CSP pinned to the Supabase origin over https and wss,
immutable caching for fingerprinted assets, `no-cache` on the shell, and
`index.html` for unknown paths so a deep link survives a refresh. Asset paths are
excluded from that fallback, so a missing bundle 404s loudly instead of returning
HTML that fails to parse.

### Auto-deploy does not currently work

`describe-service` reports the source as repo + root directory with **no branch
recorded**, so Railway watches the repository's default branch. Attaching a
source triggers a one-off build but does not appear to persist branch tracking:
two pushes to the working branch, and the merge commit onto `main`, all failed to
produce a deployment.

Until that is resolved, a deploy has to be triggered explicitly — re-attach the
source with `connect-service-source`, then **verify the deployed `commitHash` in
`list-deployments` matches what was pushed** rather than trusting a SUCCESS
status.

### Cloudflare is still wired up

`web/wrangler.jsonc` and `public/_headers` target Workers static assets, and
`.github/workflows/deploy-field-app.yml` will publish there the moment
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist as repository secrets.
The deploy step is gated on that token being present, so it skips cleanly rather
than failing a branch that does not use it. Cloudflare's free tier permits
commercial use and does not meter bandwidth; Railway bills after its trial
credit.

## What it does

- **Zones** — every zone with door count, A1 count, pipeline value and a
  progress bar showing how much has been worked
- **Route** — the walk order as large touch targets, one-tap outcomes, notes,
  Navigate to Google Maps, Call when a number exists, plus band and
  assigned-to-me filters
- **Optimize walk order** — greedy nearest-neighbour re-sequencing seeded from
  the best lead, with the mileage it saves shown up front. The launch cut's
  `stop_order` ignores geography, so routes cross their own path
- **Lead detail** — the model's own reasoning at the door: full storm history,
  MRMS radar-grid evidence, roof age and condition, estimated job value, the
  `property_ai_insights` recommendation with its rationale and confidence, and
  an absentee-owner flag derived from a mailing address that diverges from the
  site
- **Storm map** — every door placed by coordinate, coloured by worst hail on a
  validated sequential ramp, with worked doors on a shape channel
- **Search** — queries `properties` directly, so any of the ~87k scored
  addresses can be looked up, not just the 4,797 in the launch cut
- **Follow-ups** — opportunity appointments, inspections and next actions merged
  with open tasks, split overdue / upcoming / unscheduled
- **Pipeline** — live doors, pipeline value, contact rate, inspections, sold,
  and zones ranked by value
- **Re-roofed doors** are flagged from `has_recent_roof_permit` and dimmed, so
  reps skip roofs that have already been replaced

## The data behind it is currently stale

The app renders whatever the scoring model last produced. As of 2026-09-11 that
was three days old, because ingestion self-paused on a storage limit — see
[pipeline-health.md](./pipeline-health.md). The UI is working correctly; the
numbers it shows are not current.

## Things worth knowing

**RLS denials are silent.** A PostgREST update that violates a policy is not an
error — it simply matches zero rows. `recordDisposition` in `src/lib/leads.ts`
selects the updated ids back and raises when the set is empty, otherwise a rep
would see a success state for a write that never landed.

**Reps must be assigned their leads.** The `properties_org_update` policy allows
an update only when the caller is owner/admin/manager, or when
`assigned_to = auth.uid()`. Unassigned leads are read-only for a rep by design.

**Zone numbering differs from Base44.** The Base44 export renumbered zones — its
Zone 04 is Edmond, while the launch cut's Zone 04 is Luther. Treat the Supabase
`zone_name` as authoritative.

**Satellite imagery is not free.** Roof measurement needs high-resolution
imagery, and Google and Mapbox both bill per load. That feature is deliberately
not built here; everything above runs at no cost.

**The re-roofed banner will be empty for this launch cut, correctly.** 148
properties carry `has_recent_roof_permit`, but none of them are in
`okc_launch_cut` — the model already excluded them upstream. The dashboard card
and the dimmed route rows are there for future cuts that may not filter as
cleanly.

## Why not host this on Supabase?

Supabase has no static hosting product. Two workarounds exist and both are worse
than Cloudflare Pages:

- **Storage public bucket.** Serves files, but there is no SPA fallback, so a
  refresh on `/zone/...` returns 404 rather than `index.html`, and there is no
  way to set the cache or security headers in `public/_headers`.
- **An Edge Function serving HTML.** Supabase's own limits page states that
  serving HTML content is only supported with a custom domain — otherwise `GET`
  requests returning `text/html` are rewritten to `text/plain`, so the browser
  shows source instead of a page. Custom domains are a paid add-on. It also
  notes static files cannot be deployed via the API flag, and functions cap at
  256 MB memory and 2s CPU per request. Paying compute to serve bytes a CDN
  serves for free is the wrong shape.

Supabase's own docs treat hosting as a separate concern, with integration guides
for Vercel and Netlify. The intended split is what this repo does: Supabase for
Postgres, auth and realtime; a CDN for the front end.
