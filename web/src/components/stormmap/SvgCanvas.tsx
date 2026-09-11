import { useMemo } from 'react'
import type { RouteLead } from '@/lib/types'
import { Card } from '@/components/ui/primitives'
import { shortZone } from '@/lib/format'
import { isWorked, stepFor } from './shared'

const rad = (deg: number) => (deg * Math.PI) / 180
const EARTH_R = 6378137

/**
 * Web Mercator. Both axes must be in the same units for the projection to be
 * conformal - x in radians of longitude, y in the log-tangent of latitude.
 * Mixing degrees for x with radians for y silently rescales one axis.
 */
const mercX = (lon: number) => rad(lon)
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))

type Pt = { x: number; y: number }

/**
 * Andrew's monotone chain. Zone outlines are what turn a scatter of dots into
 * something a rep can orient by: without them there is no shape on screen to
 * match against the windscreen.
 */
function hull(points: Pt[]): Pt[] {
  if (points.length < 3) return points
  const p = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y))
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const build = (src: Pt[]) => {
    const out: Pt[] = []
    for (const pt of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop()
      out.push(pt)
    }
    out.pop()
    return out
  }
  return [...build(p), ...build([...p].reverse())]
}

/** A round number for the scale bar: 1, 2, 5, 10, 20, 50 km. */
function niceKm(target: number): number {
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100]
  return steps.reduce((best, s) =>
    Math.abs(s - target) < Math.abs(best - target) ? s : best, steps[0])
}

/**
 * The no-basemap canvas: points projected by hand, no tiles, no network.
 *
 * It is the default, so it has to stand on its own rather than act as a
 * placeholder for a basemap nobody configured. Zone hulls give shape, zone
 * numbers give orientation, and the scale bar gives distance - the three things
 * that separate a map from a scatter plot. It still needs nothing but the lead
 * rows, so it works with no signal and no tile host.
 */
export default function SvgCanvas({
  leads, selected, onSelect,
}: {
  leads: RouteLead[]
  selected: RouteLead | null
  onSelect: (l: RouteLead) => void
}) {
  const view = useMemo(() => {
    if (!leads.length) return null
    const xs = leads.map((l) => mercX(l.lon!))
    const ys = leads.map((l) => mercY(l.lat!))
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
    const w = x1 - x0 || 1e-6
    const h = y1 - y0 || 1e-6

    // One scale for both axes keeps it geometrically honest; the longer side
    // sets the size and the shorter one is centred in the leftover space.
    const SIZE = 100
    const scale = SIZE / Math.max(w, h)
    const vbW = w * scale
    const vbH = h * scale
    const pad = Math.max(vbW, vbH) * 0.08

    const x = (lon: number) => (mercX(lon) - x0) * scale
    // SVG y grows downward; Mercator y grows north, so this inverts.
    const y = (lat: number) => (y1 - mercY(lat)) * scale
    const unit = Math.max(vbW, vbH) / SIZE

    // Metres per viewBox unit: along a parallel, distance = R·Δλ·cos(φ), and
    // Δλ is exactly what the x axis carries.
    const midLat = (Math.atan(Math.sinh(y0)) + Math.atan(Math.sinh(y1))) / 2
    const mPerUnit = (EARTH_R * Math.cos(midLat)) / scale

    // Zones drawn as convex hulls of their own stops.
    const byZone = new Map<string, Pt[]>()
    for (const l of leads) {
      const key = l.zone_name ?? 'Unzoned'
      const arr = byZone.get(key) ?? []
      arr.push({ x: x(l.lon!), y: y(l.lat!) })
      byZone.set(key, arr)
    }
    const zones = [...byZone.entries()].map(([name, pts]) => {
      const h2 = hull(pts)
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
      return {
        name,
        label: (shortZone(name).match(/\d+/) ?? [''])[0],
        d: h2.length >= 3 ? `M${h2.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}Z` : null,
        cx, cy, count: pts.length,
      }
    })

    // Mark radius follows density. 4,797 doors at the radius that suits 300
    // is a solid mass; the zone filter is what makes the dense view readable,
    // so the all-zones view has to stay legible rather than pretty.
    const dot = leads.length > 2500 ? 0.5 : leads.length > 900 ? 0.72 : 1.05

    const km = niceKm((vbW * 0.22 * mPerUnit) / 1000)
    return {
      viewBox: `${-pad} ${-pad} ${vbW + pad * 2} ${vbH + pad * 2}`,
      unit, x, y, zones, vbW, vbH, pad, dot,
      bar: { km, units: (km * 1000) / mPerUnit },
    }
  }, [leads])

  return (
    <Card className="overflow-hidden p-2">
      <svg
        viewBox={view?.viewBox ?? '0 0 100 100'}
        preserveAspectRatio="xMidYMid meet"
        className="w-full touch-manipulation"
        role="img"
        aria-label={`Storm exposure map of ${leads.length} properties across ${view?.zones.length ?? 0} zones, coloured by maximum hail size`}
      >
        {view && (
          <>
            {/* Zone territories sit beneath the doors: shape first, then detail. */}
            <g>
              {view.zones.map((z) => z.d && (
                <path
                  key={z.name}
                  d={z.d}
                  fill="#38bdf8"
                  fillOpacity={0.05}
                  stroke="#38bdf8"
                  strokeOpacity={0.28}
                  strokeWidth={0.25 * view.unit}
                  strokeLinejoin="round"
                />
              ))}
            </g>

            <g>
              {leads.map((l) => {
                const s = stepFor(l.strongest_hail_inches)
                const done = isWorked(l)
                const on = selected?.property_id === l.property_id
                return (
                  <circle
                    key={l.property_id}
                    cx={view.x(l.lon!)}
                    cy={view.y(l.lat!)}
                    r={(on ? view.dot * 2.1 : view.dot) * view.unit}
                    fill={s.hex}
                    // Ring marks a door already worked. It is a shape channel,
                    // not a second hue, so it never competes with the hail ramp.
                    stroke={on ? '#f1f5f9' : done ? '#94a3b8' : 'none'}
                    strokeWidth={(on ? 0.6 : 0.35) * view.unit}
                    opacity={done && !on ? 0.5 : 1}
                    onClick={() => onSelect(l)}
                    className="cursor-pointer"
                  >
                    <title>{l.property_address ?? 'Address unavailable'}</title>
                  </circle>
                )
              })}
            </g>

            {/* Zone numbers last so they sit above the doors, with a halo in
                the surface colour so they stay readable over a dense cluster.
                A rep reads "14" off the route list, so the number is the label. */}
            <g style={{ pointerEvents: 'none' }}>
              {view.zones.filter((z) => z.label && z.count > 4).map((z) => (
                <text
                  key={`t-${z.name}`}
                  x={z.cx}
                  y={z.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#e2e8f0"
                  stroke="#0b1220"
                  strokeWidth={1.1 * view.unit}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                  fontSize={4.4 * view.unit}
                  fontWeight="700"
                >
                  {z.label}
                </text>
              ))}
            </g>

            {/* Scale bar and north arrow: distance and orientation, the two
                things a basemap would otherwise supply. */}
            <g style={{ pointerEvents: 'none' }}>
              <line
                x1={0} y1={view.vbH + view.pad * 0.55}
                x2={view.bar.units} y2={view.vbH + view.pad * 0.55}
                stroke="#94a3b8" strokeWidth={0.35 * view.unit}
              />
              <text
                x={view.bar.units / 2} y={view.vbH + view.pad * 0.55 - 1.1 * view.unit}
                textAnchor="middle" fill="#94a3b8" fontSize={2.6 * view.unit}
              >
                {view.bar.km} km
              </text>
              <text
                x={view.vbW} y={view.vbH + view.pad * 0.55}
                textAnchor="end" fill="#94a3b8" fontSize={2.6 * view.unit}
                fontWeight="700"
              >
                N ↑
              </text>
            </g>
          </>
        )}
      </svg>
    </Card>
  )
}
