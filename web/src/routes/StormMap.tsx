import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAllLeads } from '@/lib/leads'
import type { RouteLead } from '@/lib/types'
import { compactMoney, shortZone, zoneNumber } from '@/lib/format'
import { Badge, Button, Card, ErrorNote, Spinner, cx } from '@/components/ui/primitives'

/**
 * Hail size is a magnitude, so it gets a sequential ramp: one hue, stepped.
 * On this near-black surface the scale runs dark -> light, so "near zero"
 * recedes into the background and the worst stones are the brightest marks.
 * Validated as an ordinal ramp against a dark surface: monotone lightness,
 * every adjacent gap over the 0.06 floor, 3 degrees of hue spread, and the
 * dark end still clears the surface at 2.15:1 (better here, since this
 * surface is darker than the one it was checked against).
 */
const RAMP = [
  { min: 0,   hex: '#184f95', label: 'under 1"' },
  { min: 1,   hex: '#2a78d6', label: '1–1.5"' },
  { min: 1.5, hex: '#5598e7', label: '1.5–2"' },
  { min: 2,   hex: '#86b6ef', label: '2–2.5"' },
  { min: 2.5, hex: '#b7d3f6', label: '2.5"+' },
]

const stepFor = (inches: number | null) => {
  const n = inches ?? 0
  for (let i = RAMP.length - 1; i >= 0; i--) if (n >= RAMP[i].min) return RAMP[i]
  return RAMP[0]
}

const WORKED = new Set([
  'knocked', 'contact_made', 'inspection_set', 'inspection_scheduled',
  'inspection_complete', 'estimate_sent', 'estimate', 'claim_filed',
  'contract_signed', 'sold', 'lost', 'not_qualified', 'do_not_contact',
])

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Web Mercator. Both axes must be in the same units for the projection to be
 * conformal - x in radians of longitude, y in the log-tangent of latitude. Mixing
 * degrees for x with radians for y silently rescales one axis against the other.
 */
const mercX = (lon: number) => rad(lon)
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))

export default function StormMap() {
  const [leads, setLeads] = useState<RouteLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zone, setZone] = useState<string | null>(null)
  const [selected, setSelected] = useState<RouteLead | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    fetchAllLeads().then(setLeads).catch((e) => setError(e.message))
  }, [])

  const zones = useMemo(
    () => [...new Set(leads?.map((l) => l.zone_name) ?? [])]
      .sort((a, b) => zoneNumber(a) - zoneNumber(b)),
    [leads],
  )

  const shown = useMemo(
    () => (leads ?? []).filter(
      (l) => l.lat != null && l.lon != null && (!zone || l.zone_name === zone),
    ),
    [leads, zone],
  )

  /**
   * Recomputed from whatever is on screen, so drilling into a zone fills the
   * frame instead of sitting marooned in a corner of the metro.
   *
   * The viewBox takes the data's own aspect rather than a fixed square, and both
   * axes share one scale factor. Forcing this into a square squashed the metro's
   * 48 km east-west extent into its 19 km north-south one - a 2.5x distortion
   * that would put the street grid at odds with what a rep sees out the window.
   */
  const proj = useMemo(() => {
    if (!shown.length) return null
    const xs = shown.map((l) => mercX(l.lon!))
    const ys = shown.map((l) => mercY(l.lat!))
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
      // Marks scale with the frame so they stay legible when a zone is zoomed.
      unit: Math.max(vbW, vbH) / SIZE,
      x: (lon: number) => (mercX(lon) - x0) * scale,
      // SVG y grows downward; Mercator y grows north, so this inverts.
      y: (lat: number) => (y1 - mercY(lat)) * scale,
    }
  }, [shown])

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (!leads) return <Spinner label="Plotting storm exposure" />

  const worked = shown.filter((l) => l.lead_status && WORKED.has(l.lead_status)).length

  return (
    <div className="space-y-3 p-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Storm map</h1>
        <p className="text-sm text-ink-400">
          {shown.length.toLocaleString()} doors · {worked} worked
          {zone && ` · ${shortZone(zone)}`}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button tone={zone ? 'muted' : 'primary'} onClick={() => { setZone(null); setSelected(null) }}>
          All zones
        </Button>
        {zones.slice(0, 8).map((z) => (
          <Button
            key={z}
            tone={zone === z ? 'primary' : 'muted'}
            onClick={() => { setZone((v) => (v === z ? null : z)); setSelected(null) }}
          >
            {shortZone(z).replace(/ · .*/, '')}
          </Button>
        ))}
      </div>

      <Card className="overflow-hidden p-2">
        <svg
          ref={svgRef}
          viewBox={proj?.viewBox ?? '0 0 100 100'}
          preserveAspectRatio="xMidYMid meet"
          className="w-full touch-manipulation"
          role="img"
          aria-label={`Storm exposure map of ${shown.length} properties, coloured by maximum hail size`}
        >
          {proj && shown.map((l) => {
            const s = stepFor(l.strongest_hail_inches)
            const done = !!l.lead_status && WORKED.has(l.lead_status)
            const on = selected?.property_id === l.property_id
            return (
              <circle
                key={l.property_id}
                cx={proj.x(l.lon!)}
                cy={proj.y(l.lat!)}
                r={(on ? 1.5 : 0.65) * (proj?.unit ?? 1)}
                fill={s.hex}
                // Ring marks a door already worked. It is a shape channel, not a
                // second hue, so it never competes with the hail ramp.
                stroke={on ? '#f1f5f9' : done ? '#94a3b8' : 'none'}
                strokeWidth={(on ? 0.45 : 0.3) * (proj?.unit ?? 1)}
                opacity={done && !on ? 0.55 : 1}
                onClick={() => setSelected(l)}
                className="cursor-pointer"
              />
            )
          })}
        </svg>
      </Card>

      {selected && (
        <Card className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                to={`/lead/${selected.property_id}`}
                className="block truncate font-semibold underline-offset-2 hover:underline"
              >
                {selected.property_address ?? 'Address unavailable'}
              </Link>
              <div className="truncate text-xs text-ink-400">
                {selected.owner_name ?? 'Owner unknown'} · {shortZone(selected.zone_name)}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="shrink-0 px-2 text-ink-400"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selected.strongest_hail_inches != null && (
              <Badge tone="warn">{selected.strongest_hail_inches}" hail</Badge>
            )}
            {selected.band && <Badge>{selected.band}</Badge>}
            {selected.market_value != null && <Badge>{compactMoney(selected.market_value)}</Badge>}
            {selected.lead_status && (
              <Badge tone="go">{selected.lead_status.replace(/_/g, ' ')}</Badge>
            )}
          </div>
        </Card>
      )}

      <Legend />
    </div>
  )
}

function Legend() {
  return (
    <Card className="p-3">
      <div className="text-xs uppercase tracking-wider text-ink-400">Max hail</div>
      <div className="mt-2 flex items-center gap-1">
        {RAMP.map((s) => (
          <div key={s.hex} className="flex-1">
            <div className="h-2 rounded-sm" style={{ background: s.hex }} />
            <div className="mt-1 text-center text-[10px] text-ink-400">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-ink-400">
        <span className="flex items-center gap-1.5">
          <span className={cx('inline-block size-2.5 rounded-full')} style={{ background: '#86b6ef' }} />
          not yet worked
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full opacity-55"
            style={{ background: '#86b6ef', boxShadow: '0 0 0 1.5px #94a3b8' }}
          />
          worked
        </span>
      </div>
    </Card>
  )
}
