import { Link } from 'react-router-dom'
import type { RouteLead } from '@/lib/types'
import { compactMoney, shortZone } from '@/lib/format'
import { Badge, Card, cx } from '@/components/ui/primitives'

/**
 * Hail size is a magnitude, so it gets a sequential ramp: one hue, stepped.
 * On this near-black surface the scale runs dark -> light, so "near zero"
 * recedes into the background and the worst stones are the brightest marks.
 * Validated as an ordinal ramp against a dark surface: monotone lightness,
 * every adjacent gap over the 0.06 floor, 3 degrees of hue spread, and the
 * dark end still clears the surface at 2.15:1.
 *
 * These steps are shared by both canvases so the SVG and the GL basemap never
 * disagree about what a colour means.
 */
export const RAMP = [
  { min: 0,   hex: '#184f95', label: 'under 1"' },
  { min: 1,   hex: '#2a78d6', label: '1–1.5"' },
  { min: 1.5, hex: '#5598e7', label: '1.5–2"' },
  { min: 2,   hex: '#86b6ef', label: '2–2.5"' },
  { min: 2.5, hex: '#b7d3f6', label: '2.5"+' },
]

export const stepFor = (inches: number | null) => {
  const n = inches ?? 0
  for (let i = RAMP.length - 1; i >= 0; i--) if (n >= RAMP[i].min) return RAMP[i]
  return RAMP[0]
}

export const WORKED = new Set([
  'knocked', 'contact_made', 'inspection_set', 'inspection_scheduled',
  'inspection_complete', 'estimate_sent', 'estimate', 'claim_filed',
  'contract_signed', 'sold', 'lost', 'not_qualified', 'do_not_contact',
])

export const isWorked = (l: RouteLead) => !!l.lead_status && WORKED.has(l.lead_status)

export function SelectedLead({
  lead, onClose,
}: { lead: RouteLead; onClose: () => void }) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/lead/${lead.property_id}`}
            className="block truncate font-semibold underline-offset-2 hover:underline"
          >
            {lead.property_address ?? 'Address unavailable'}
          </Link>
          <div className="truncate text-xs text-ink-400">
            {lead.owner_name ?? 'Owner unknown'} · {shortZone(lead.zone_name)}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="shrink-0 px-2 text-ink-400">
          ✕
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {lead.strongest_hail_inches != null && (
          <Badge tone="warn">{lead.strongest_hail_inches}" hail</Badge>
        )}
        {lead.band && <Badge>{lead.band}</Badge>}
        {lead.market_value != null && <Badge>{compactMoney(lead.market_value)}</Badge>}
        {lead.lead_status && <Badge tone="go">{lead.lead_status.replace(/_/g, ' ')}</Badge>}
      </div>
    </Card>
  )
}

export function Legend({ attribution }: { attribution?: string }) {
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
      {/* OpenStreetMap data is ODbL; attribution is a licence condition, not decoration. */}
      {attribution && (
        <div className="mt-3 border-t border-ink-700 pt-2 text-[10px] text-ink-400">
          {attribution}
        </div>
      )}
    </Card>
  )
}
