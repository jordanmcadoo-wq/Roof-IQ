import { useMemo } from 'react'
import type { RouteLead } from '@/lib/types'
import { Card } from '@/components/ui/primitives'
import { isWorked, stepFor } from './shared'

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Web Mercator. Both axes must be in the same units for the projection to be
 * conformal - x in radians of longitude, y in the log-tangent of latitude.
 * Mixing degrees for x with radians for y silently rescales one axis.
 */
const mercX = (lon: number) => rad(lon)
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))

/**
 * The no-basemap canvas: points projected by hand, no tiles, no network.
 *
 * This is the fallback when no basemap is configured, and it is deliberately
 * kept rather than deleted -- it needs nothing but the lead rows, so the map
 * tab still works if the tile host is unreachable or was never set up.
 */
export default function SvgCanvas({
  leads, selected, onSelect,
}: {
  leads: RouteLead[]
  selected: RouteLead | null
  onSelect: (l: RouteLead) => void
}) {
  const proj = useMemo(() => {
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
    const pad = Math.max(vbW, vbH) * 0.06

    return {
      viewBox: `${-pad} ${-pad} ${vbW + pad * 2} ${vbH + pad * 2}`,
      unit: Math.max(vbW, vbH) / SIZE,
      x: (lon: number) => (mercX(lon) - x0) * scale,
      // SVG y grows downward; Mercator y grows north, so this inverts.
      y: (lat: number) => (y1 - mercY(lat)) * scale,
    }
  }, [leads])

  return (
    <Card className="overflow-hidden p-2">
      <svg
        viewBox={proj?.viewBox ?? '0 0 100 100'}
        preserveAspectRatio="xMidYMid meet"
        className="w-full touch-manipulation"
        role="img"
        aria-label={`Storm exposure map of ${leads.length} properties, coloured by maximum hail size`}
      >
        {proj && leads.map((l) => {
          const s = stepFor(l.strongest_hail_inches)
          const done = isWorked(l)
          const on = selected?.property_id === l.property_id
          return (
            <circle
              key={l.property_id}
              cx={proj.x(l.lon!)}
              cy={proj.y(l.lat!)}
              r={(on ? 1.5 : 0.65) * proj.unit}
              fill={s.hex}
              // Ring marks a door already worked. It is a shape channel, not a
              // second hue, so it never competes with the hail ramp.
              stroke={on ? '#f1f5f9' : done ? '#94a3b8' : 'none'}
              strokeWidth={(on ? 0.45 : 0.3) * proj.unit}
              opacity={done && !on ? 0.55 : 1}
              onClick={() => onSelect(l)}
              className="cursor-pointer"
            />
          )
        })}
      </svg>
    </Card>
  )
}
