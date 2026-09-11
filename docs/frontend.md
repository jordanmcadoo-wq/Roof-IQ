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
| Hosting | Cloudflare Pages | Free tier permits commercial use; unlimited bandwidth |

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

The app reads a single view, `public.rep_route_leads`. Apply it before first run:

```
supabase/migrations/20260911000000_rep_route_leads_view.sql
```

It exists for two concrete reasons:

1. `okc_launch_cut` has no foreign key to `properties`, so PostgREST cannot
   embed the join and the client would otherwise need N+1 round trips.
2. `geom` is a PostGIS `geography` column. Selected raw over PostgREST it
   returns EWKB hex, which is useless to a map. The view projects `st_y`/`st_x`
   into plain numeric `lat`/`lon`.

The view is declared `security_invoker = true`, so it runs as the querying user
and the existing RLS policies still apply. A view without that flag would run as
its owner and silently bypass row-level security.

## Deploying to Cloudflare Pages

The project is named `roofiq-field` (`web/wrangler.toml`). Pick either route.

### Route A — Git integration, no CI secrets

Cloudflare builds on every push. Simplest to set up.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, and pick this repository
2. **Project name:** `roofiq-field`
3. **Root directory:** `web`
4. **Build command:** `npm run build`
5. **Build output directory:** `dist` (relative to the root directory)
6. Under **Settings → Environment variables**, add for *both* Production and
   Preview:
   - `VITE_SUPABASE_URL` → `https://bmnhxvdnvytdrpqgvxts.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` → the publishable key

Vite only inlines variables prefixed `VITE_` at **build** time, so these must be
set before the build runs. Adding them afterwards requires a redeploy.

### Route B — GitHub Actions

`.github/workflows/deploy-field-app.yml` builds and deploys on pushes to `main`
that touch `web/`, and builds every pull request. It needs, in repo settings:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Token with **Account → Cloudflare Pages → Edit** |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard sidebar |
| Variable | `VITE_SUPABASE_URL` | `https://bmnhxvdnvytdrpqgvxts.supabase.co` |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable key |

Create the token at **My Profile → API Tokens → Create Token → Custom token**.
Scope it to Cloudflare Pages Edit on that account only — nothing here needs
Zone or DNS permissions.

The Supabase values are repo *variables*, not secrets, on purpose: the
publishable key is meant to ship inside the browser bundle. Row-level security
guards the data. Marking it secret would imply a protection it does not provide
and only makes rotation harder.

### Deploying by hand

```bash
cd web
npx wrangler login          # or export CLOUDFLARE_API_TOKEN
npm run deploy              # builds, then wrangler pages deploy
```

### What ships alongside the bundle

`public/_redirects` sends every path to `index.html`, so a hard refresh on a
deep link like `/zone/OKC%20Launch%20·%20Zone%2008` still resolves.

`public/_headers` sets cache and security policy:

- `/assets/*` is immutable for a year — Vite fingerprints those filenames
- `/index.html` is `no-cache`, or a deploy strands reps on stale JS pointing at
  asset hashes the CDN no longer serves
- A Content-Security-Policy pinned to the `roofiq-ai` Supabase origin over both
  https and wss. `style-src` permits inline because progress bars set width
  through a style attribute; `script-src` is `'self'` with no exceptions, which
  the build satisfies — it emits no inline scripts

**If you point the app at a different Supabase project, update `connect-src` in
`public/_headers`.** Otherwise the browser silently blocks every query and the
app looks broken with nothing useful in the console.

## What it does

- **Zones** — every zone with door count, A1 count, pipeline value and a
  progress bar showing how much has been worked
- **Route** — the walk order as large touch targets, one-tap outcomes, notes,
  Navigate to Google Maps, and Call when a number exists
- **Optimize walk order** — greedy nearest-neighbour re-sequencing seeded from
  the best lead, with the mileage it saves shown up front. The launch cut's
  `stop_order` ignores geography, so routes cross their own path
- **Pipeline** — live doors, pipeline value, contact rate, inspections, sold,
  and zones ranked by value
- **Re-roofed doors** are flagged from `has_recent_roof_permit` and dimmed, so
  reps skip roofs that have already been replaced

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
