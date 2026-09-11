# Map basemap

The storm map has two canvases and picks one at build time.

| `VITE_BASEMAP_URL` | Canvas | Needs tiles? | Cost |
|---|---|---|---|
| unset (default) | projected points + highways, hand-drawn SVG | no | 7KB, on the map tab only |
| a MapLibre style URL | MapLibre GL, full street basemap | yes | 291KB gz, lazy |

Both draw from the same `RAMP` and the same worked/not-worked rule, so they
cannot disagree about what a colour means.

## What the default already gives you

The tile-free canvas is not a placeholder. It carries:

- **Highways** from `public/basemap/roads.json` — Natural Earth 10m roads
  (public domain), clipped to the Central Oklahoma service area. 51 segments,
  **7 KB**: I-35, I-40, I-44, I-235, I-240, US-62, US-77, US-81, with route
  shields on the majors. Those are the corridors the campaign is organised
  around, so the labels match the plan on the wall.
- **Zone outlines**, as convex hulls of each zone's own stops.
- **Zone numbers**, drawn above the doors with a halo so they survive a dense
  cluster.
- **A scale bar and north arrow**, computed from the projection rather than
  assumed.

It is orientation, not navigation — enough to know which side of I-40 a cluster
sits on, not which driveway. It is fetched rather than bundled, so it costs the
other tabs nothing, and a failed fetch simply drops the roads.

Add a `.pmtiles` below when you want the full street grid.

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

## Turning on the full street grid

Everything except the archive itself is already committed and verified. One
file is all that is left:

1. Go to <https://app.protomaps.com>, draw a box over the service area and
   **set the maximum zoom** — this is what decides the file size:

   | Max zoom | What a rep gets | Rough size, metro box |
   |---|---|---|
   | 13 | shape of towns, major roads | a few MB |
   | 14 | street grid, no small names | ~5-20 MB |
   | 15 | named residential streets | ~20-60 MB |
   | 16 | every driveway | 100 MB+ |

   **Zoom 14-15 is the right range for door knocking.** Zoom 16 is navigation
   detail nobody reads off a phone at a front door.

2. Save it as **`web/public/basemap/okc.pmtiles`**.
3. Deploy.

No environment variable, no rebuild flag, no code change. On the map tab the app
sends a `HEAD` to `/basemap/okc.pmtiles`; if it answers, the MapLibre canvas
loads with the committed style, and if it 404s the tile-free canvas is used.

### Two bounding boxes

- **Current coverage** — the 4,797 routable doors all sit in the north metro:
  `-97.70, 35.53` to `-97.12, 35.75`. Small, and the honest choice while the
  property inventory is north-metro only.
- **Full campaign footprint** — Chickasha to Luther:
  `-98.45, 34.70` to `-96.70, 36.05`. Only worth the size once the inventory
  covers those towns; today the map has nothing to draw there.

### Where the file can live

**Git has a hard 100 MB per-file limit**, and Railway builds from git, so the
archive has to clear that bar to ride along in the repo. Under ~50 MB is
comfortable; above it, either lower the max zoom, tighten the box, or host the
archive separately and point `VITE_BASEMAP_URL` at a style that references it,
with `BASEMAP_ORIGIN` set to that host. Cloudflare R2 suits this well — 10 GB
free, no egress charge — but R2 has to be enabled in the Cloudflare dashboard
first.

### What is already done

- **`public/basemap/style.json`** — 57 layers, generated from
  `protomaps-themes-base` in its dark theme. It uses the **no-labels** variant
  deliberately: labelled layers need glyph `.pbf` files from an external font
  host, which would break both the offline guarantee and the same-origin CSP.
  Route numbers come from the Natural Earth layer instead.
- **`pmtiles://` protocol registration** in `GlCanvas`.
- **HTTP range requests in `server.mjs`.** PMTiles reads an archive by byte
  range and never whole; without this MapLibre would refetch ~100 MB per tile.
  Single ranges, suffix ranges (the footer probe) and `416` are all handled,
  and files over 4 MB stream rather than being read into memory. Verified
  against a planted archive: `bytes=0-15`, `bytes=1000-1099`, `bytes=-8` and
  `bytes=50000-50003` all return `206` with byte-exact content.
- **`/basemap/` excluded from the SPA fallback,** so a missing archive returns
  `404` rather than `index.html` with a `200`. The auto-detection depends on
  that answer meaning something.
- **`.pmtiles` MIME type** (`application/vnd.pmtiles`).

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
