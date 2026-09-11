import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { RouteLead } from '@/lib/types'
import { Card, ErrorNote } from '@/components/ui/primitives'
import { RAMP, isWorked } from './shared'

/**
 * Registered once per page, not per mount. addProtocol installs a global
 * handler, so doing it in the effect would re-register on every zone change.
 * This lets a style reference pmtiles://... , which is how a single
 * self-hosted .pmtiles file works with no tile server and no API key.
 */
let protocolReady = false
function ensurePmtilesProtocol() {
  if (protocolReady) return
  maplibregl.addProtocol('pmtiles', new Protocol().tile)
  protocolReady = true
}

const SOURCE = 'roofiq-leads'

/**
 * Points are handed to MapLibre as real GeoJSON in lon/lat. There is no hand
 * projection here on purpose: the camera owns the projection, so the marks stay
 * registered against the street grid at every zoom and rotation.
 */
function toGeoJson(leads: RouteLead[]) {
  return {
    type: 'FeatureCollection' as const,
    features: leads.map((l) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [l.lon!, l.lat!] },
      properties: {
        id: l.property_id,
        hail: l.strongest_hail_inches ?? 0,
        worked: isWorked(l) ? 1 : 0,
      },
    })),
  }
}

/**
 * The hail ramp as a MapLibre step expression, built from the same RAMP the
 * SVG canvas and the legend use, so the three cannot drift apart.
 */
function hailColorExpression() {
  const expr: unknown[] = ['step', ['get', 'hail'], RAMP[0].hex]
  for (const s of RAMP.slice(1)) expr.push(s.min, s.hex)
  return expr
}

function bounds(leads: RouteLead[]): [[number, number], [number, number]] | null {
  if (!leads.length) return null
  let w = 180, s = 90, e = -180, n = -90
  for (const l of leads) {
    if (l.lon! < w) w = l.lon!
    if (l.lon! > e) e = l.lon!
    if (l.lat! < s) s = l.lat!
    if (l.lat! > n) n = l.lat!
  }
  return [[w, s], [e, n]]
}

export default function GlCanvas({
  leads, styleUrl, selected, onSelect,
}: {
  leads: RouteLead[]
  styleUrl: string
  selected: RouteLead | null
  onSelect: (l: RouteLead) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // onSelect is read through a ref so the click handler, bound once at load,
  // never closes over a stale callback.
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    if (!holder.current || map.current) return
    ensurePmtilesProtocol()

    let m: MlMap
    try {
      m = new maplibregl.Map({
        container: holder.current,
        style: styleUrl as unknown as StyleSpecification,
        center: [-97.52, 35.55],
        zoom: 9,
        attributionControl: false,
      })
    } catch (e) {
      setError((e as Error).message)
      return
    }
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right')

    // A bad style URL fails here rather than throwing at construction, so this
    // is what turns an unreachable tile host into a visible message instead of
    // a blank grey rectangle.
    m.on('error', (e) => setError(e.error?.message ?? 'The basemap failed to load.'))

    m.on('load', () => {
      m.addSource(SOURCE, { type: 'geojson', data: toGeoJson(leads) })
      m.addLayer({
        id: 'leads-worked-ring',
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['get', 'worked'], 1],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 8],
          'circle-color': 'rgba(0,0,0,0)',
          // Worked is a shape channel (a ring), never a second hue, so it does
          // not compete with the hail ramp.
          'circle-stroke-color': '#94a3b8',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.55,
        },
      })
      m.addLayer({
        id: 'leads',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 15, 7],
          'circle-color': hailColorExpression() as never,
          'circle-opacity': ['case', ['==', ['get', 'worked'], 1], 0.55, 0.95],
        },
      })

      m.on('click', 'leads', (ev) => {
        const id = ev.features?.[0]?.properties?.id
        const hit = leads.find((l) => l.property_id === id)
        if (hit) select.current(hit)
      })
      m.on('mouseenter', 'leads', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'leads', () => { m.getCanvas().style.cursor = '' })

      setReady(true)
    })

    return () => { m.remove(); map.current = null }
    // styleUrl only: rebuilding the map when leads change would throw away the
    // camera the rep just positioned. Lead updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl])

  // Data and camera follow the filtered set without recreating the map.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const src = m.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData(toGeoJson(leads) as never)
    const b = bounds(leads)
    if (b) m.fitBounds(b, { padding: 40, duration: 400, maxZoom: 15 })
  }, [leads, ready])

  // Selection is drawn by MapLibre rather than a DOM marker so it stays pinned
  // to its coordinate through pan, zoom and rotate.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const id = 'lead-selected'
    if (m.getLayer(id)) m.removeLayer(id)
    if (m.getSource(id)) m.removeSource(id)
    if (!selected?.lat || !selected?.lon) return
    m.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] },
        properties: {},
      },
    })
    m.addLayer({
      id,
      type: 'circle',
      source: id,
      paint: {
        'circle-radius': 9,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#f1f5f9',
        'circle-stroke-width': 2.5,
      },
    })
  }, [selected, ready])

  return (
    <>
      {error && (
        <div className="mb-3">
          <ErrorNote error={`${error} Showing the basemap-free view is still possible — unset VITE_BASEMAP_URL.`} />
        </div>
      )}
      <Card className="overflow-hidden p-0">
        <div
          ref={holder}
          className="h-[60vh] min-h-80 w-full"
          role="application"
          aria-label={`Storm exposure map of ${leads.length} properties on a street basemap`}
        />
      </Card>
    </>
  )
}
