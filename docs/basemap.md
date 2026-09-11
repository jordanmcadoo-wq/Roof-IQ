# Map basemap

The storm map has two canvases and picks one at build time.

| `VITE_BASEMAP_URL` | Canvas | Needs tiles? | Bundle cost |
|---|---|---|---|
| unset (default) | projected points, hand-drawn SVG | no | none |
| a MapLibre style URL | MapLibre GL, street basemap | yes | 291KB gz, lazy |

Both draw from the same `RAMP` and the same worked/not-worked rule, so they
cannot disagree about what a colour means.

## Why MapLibre + self-hosted Protomaps

**OpenStreetMap's community tile server is not an option here.** Their Tile
Usage Policy forbids heavy and commercial use, and a sales team knocking doors
is commercial. Apps that use it anyway get blocked, usually at the worst moment.

The recommended setup is a single Protomaps `.pmtiles` file served from this
app's own origin:

- **No API key, no quota, no account, no billing.** Free in the durable sense.
- **The CSP stays locked to `'self'`.** Nothing is opened to a third party.
  This matters because the same deployment carries the Supabase session.
- **Small.** RoofIQ covers the north OKC metro, not the planet.
- **One file.** No tile server to run or monitor.

MapLibre also lets hail evidence be real geographic layers rather than points
projected by hand, so marks stay registered to the street grid at any zoom.

## Setting it up with Protomaps (recommended)

1. Build a metro extract. From <https://app.protomaps.com> draw a box around the
   service area and download the `.pmtiles`, or cut one locally:

   ```sh
   # pmtiles CLI, from a region file such as Geofabrik's oklahoma-latest.osm.pbf
   pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles okc.pmtiles \
     --bbox=-97.85,35.35,-97.20,35.75
   ```

2. Put `okc.pmtiles` and a `style.json` under `web/public/basemap/`. Everything
   in `public/` is served as a static asset, so both end up same-origin.

3. In the style, point the vector source at the file through the pmtiles
   protocol, which `GlCanvas` registers:

   ```json
   { "sources": { "protomaps": { "type": "vector", "url": "pmtiles:///basemap/okc.pmtiles" } } }
   ```

   A ready-made dark style is available from `protomaps-themes-base`.

4. Set `VITE_BASEMAP_URL=/basemap/style.json` and rebuild. Leave
   `BASEMAP_ORIGIN` unset — the file is same-origin.

## Setting it up with a hosted style

If you would rather not host the file, any MapLibre style URL works (MapTiler
and Stadia both have free tiers):

```sh
VITE_BASEMAP_URL=https://api.maptiler.com/maps/dataviz-dark/style.json?key=KEY
BASEMAP_ORIGIN=https://api.maptiler.com
```

`BASEMAP_ORIGIN` is parsed with `new URL()` and reduced to its origin before it
reaches the header, so a key in the query string is never echoed into the CSP
and a malformed value cannot inject directives. A key in `VITE_BASEMAP_URL` is
still public — it ships in the client bundle, as it does with every web map. Use
the provider's domain restrictions.

## What is verified and what is not

Verified here: the app builds; MapLibre is code-split into a chunk that loads
only when the map tab opens with a basemap configured; the default no-basemap
path is unchanged; the served CSP carries `worker-src 'self' blob:` (without it
MapLibre fails silently, since it parses tiles in blob workers); and
`BASEMAP_ORIGIN` adds exactly one origin with any key stripped.

**Not verified: tiles actually rendering.** Every tile host is unreachable from
the environment this was built in, so no basemap could be loaded even once. The
first run against a real style is the real test. If it fails, `GlCanvas` surfaces
MapLibre's own error rather than showing a blank grey rectangle, and unsetting
`VITE_BASEMAP_URL` returns to the working SVG view.
