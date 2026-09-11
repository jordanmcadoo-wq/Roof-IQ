# Basemap assets

`roads.json` — Natural Earth 10m roads (public domain, no attribution required),
clipped to the Central Oklahoma service area and rounded to 4 decimal places
(~11 m). 51 segments, 7 KB. It carries the interstates and US highways the
campaign is organised around: I-35, I-40, I-44, I-235, I-240, US-62, US-77,
US-81.

It is deliberately coarse. It is orientation, not navigation — enough to know
which side of I-40 a cluster sits on. For a full street grid, add a Protomaps
`.pmtiles` here and set `VITE_BASEMAP_URL`; see `docs/basemap.md`.

Served from `public/`, so it is same-origin and needs no CSP change.
