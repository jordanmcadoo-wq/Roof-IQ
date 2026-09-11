import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchZoneLeads } from '@/lib/leads'
import { fetchFieldOutcomes, recordFieldOutcome } from '@/lib/outcomes'
import type { FieldOutcome, LeadStatus, RouteLead } from '@/lib/types'
import { outcomeLabel, outcomeTone } from '@/lib/types'
import { compactMoney, hail, relativeDays, shortZone } from '@/lib/format'
import { mapsUrl, optimizeWalkOrder, routeMiles } from '@/lib/geo'
import { useSession } from '@/components/Session'
import {
  Badge, BandBadge, Button, Card, Empty, ErrorNote, Spinner,
} from '@/components/ui/primitives'

const DONE = new Set<LeadStatus>([
  'knocked', 'contact_made', 'inspection_set', 'inspection_scheduled',
  'inspection_complete', 'estimate_sent', 'estimate', 'claim_filed',
  'contract_signed', 'sold', 'lost', 'not_qualified', 'do_not_contact',
])

export default function RouteView() {
  const { zone = '' } = useParams()
  const zoneName = decodeURIComponent(zone)
  const { session } = useSession()

  const [leads, setLeads] = useState<RouteLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [optimized, setOptimized] = useState(false)
  const [hideDone, setHideDone] = useState(true)
  const [bandFilter, setBandFilter] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)

  const [outcomes, setOutcomes] = useState<FieldOutcome[]>([])

  useEffect(() => {
    fetchZoneLeads(zoneName).then(setLeads).catch((e) => setError(e.message))
  }, [zoneName])

  // The outcome list is small, org-wide and identical for every stop, so it is
  // fetched once per zone rather than per card.
  useEffect(() => {
    fetchFieldOutcomes().then(setOutcomes).catch((e) => setError(e.message))
  }, [])

  const ordered = useMemo(() => {
    if (!leads) return []
    const base = optimized
      // Seed from the best lead so the rep starts on their strongest door
      // rather than wherever the launch cut happened to begin.
      ? optimizeWalkOrder(leads, (l) => -(l.rank_score ?? 9999))
      : [...leads].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0))
    let out = hideDone ? base.filter((l) => !(l.lead_status && DONE.has(l.lead_status))) : base
    if (bandFilter) out = out.filter((l) => l.band === bandFilter)
    if (mineOnly) out = out.filter((l) => l.assigned_to === session.user.id)
    return out
  }, [leads, optimized, hideDone, bandFilter, mineOnly, session.user.id])

  const savedMiles = useMemo(() => {
    if (!leads || leads.length < 3) return null
    const original = routeMiles([...leads].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)))
    const better = routeMiles(optimizeWalkOrder(leads, (l) => -(l.rank_score ?? 9999)))
    return original - better
  }, [leads])

  /**
   * An empty list has several causes and they are not interchangeable. Saying
   * "zone complete" when a filter did the emptying is a claim the rep can act
   * on and be wrong about -- a rep with no leads assigned would be told the
   * zone was finished. Name the filter actually responsible instead.
   */
  const emptyState = useMemo(() => {
    if (!leads?.length) {
      return {
        title: 'No leads in this zone',
        body: 'Nothing has been routed here yet.',
      }
    }
    if (mineOnly && !leads.some((l) => l.assigned_to === session.user.id)) {
      return {
        title: 'None of these are yours',
        body: 'No lead in this zone is assigned to you. Switch to All reps to see the rest.',
      }
    }
    if (bandFilter && !leads.some((l) => l.band === bandFilter)) {
      return {
        title: `No ${bandFilter} leads here`,
        body: 'Clear the band filter to see the other doors in this zone.',
      }
    }
    if (hideDone) {
      return {
        title: 'Zone complete',
        body: 'Every door here has an outcome. Switch to Showing all to review them.',
      }
    }
    return {
      title: 'Nothing to show',
      body: 'The current filters exclude every door in this zone.',
    }
  }, [leads, mineOnly, bandFilter, hideDone, session.user.id])

  function applyLocal(propertyId: string, status: LeadStatus) {
    setLeads((prev) =>
      prev?.map((l) =>
        l.property_id === propertyId
          ? { ...l, lead_status: status, last_contacted_at: new Date().toISOString() }
          : l,
      ) ?? prev,
    )
  }

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (!leads) return <Spinner label="Loading route" />

  const done = leads.filter((l) => l.lead_status && DONE.has(l.lead_status)).length
  const bands = [...new Set(leads.map((l) => l.band).filter(Boolean))].sort() as string[]

  return (
    <div className="p-4">
      <header className="mb-4">
        <Link to="/" className="text-sm text-cool-500">← Zones</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{shortZone(zoneName)}</h1>
        <p className="text-sm text-ink-400">
          {done} of {leads.length} doors worked
          {savedMiles != null && savedMiles > 0.05 && (
            <> · optimizing saves ~{savedMiles.toFixed(1)} mi</>
          )}
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          tone={optimized ? 'primary' : 'muted'}
          onClick={() => setOptimized((v) => !v)}
        >
          {optimized ? 'Optimized order' : 'Optimize walk order'}
        </Button>
        <Button tone="muted" onClick={() => setHideDone((v) => !v)}>
          {hideDone ? 'Hiding worked' : 'Showing all'}
        </Button>
        <Button
          tone={mineOnly ? 'primary' : 'muted'}
          onClick={() => setMineOnly((v) => !v)}
        >
          {mineOnly ? 'Mine only' : 'All reps'}
        </Button>
        {bands.map((b) => (
          <Button
            key={b}
            tone={bandFilter === b ? 'primary' : 'muted'}
            onClick={() => setBandFilter((v) => (v === b ? null : b))}
          >
            {b}
          </Button>
        ))}
      </div>

      {!ordered.length ? (
        <Empty title={emptyState.title} body={emptyState.body} />
      ) : (
        <ol className="space-y-3">
          {ordered.map((lead, i) => (
            <LeadCard
              key={lead.property_id}
              lead={lead}
              position={i + 1}
              actorId={session.user.id}
              outcomes={outcomes}
              onSaved={applyLocal}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function LeadCard({
  lead, position, actorId, outcomes, onSaved,
}: {
  lead: RouteLead
  position: number
  actorId: string
  outcomes: FieldOutcome[]
  onSaved: (id: string, status: LeadStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [taught, setTaught] = useState<'labelled' | 'status-only' | null>(null)

  async function file(outcome: FieldOutcome) {
    setBusy(true); setError(null)
    try {
      const result = await recordFieldOutcome({ lead, code: outcome.code, note, actorId })
      onSaved(lead.property_id, result.lead_status as LeadStatus)
      setOpen(false); setNote('')
      // A neutral code carries no target, so it moves the lead along without
      // producing a training label. Say so rather than implying every knock
      // teaches the model something.
      setTaught(result.training_row ? 'labelled' : 'status-only')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const address = lead.property_address ?? 'Address unavailable'
  const reroofed = lead.has_recent_roof_permit === true

  return (
    <li>
      <Card className={reroofed ? 'p-4 opacity-70' : 'p-4'}>
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-ink-700 text-sm font-bold tabular-nums">
            {position}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <Link
                to={`/lead/${lead.property_id}`}
                className="min-w-0 truncate font-semibold underline-offset-2 hover:underline"
              >
                {address}
              </Link>
              <BandBadge band={lead.band} />
            </div>
            <p className="mt-0.5 truncate text-sm text-ink-400">
              {lead.owner_name ?? 'Owner unknown'}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {lead.strongest_hail_inches != null && (
                <Badge tone="warn">{hail(lead.strongest_hail_inches)} hail</Badge>
              )}
              {lead.market_value != null && <Badge>{compactMoney(lead.market_value)}</Badge>}
              {lead.lead_status && <Badge tone="go">{lead.lead_status.replace(/_/g, ' ')}</Badge>}
              {reroofed && <Badge tone="act">Recently re-roofed — skip</Badge>}
              {lead.last_contacted_at && (
                <Badge>Last touched {relativeDays(lead.last_contacted_at)}</Badge>
              )}
            </div>

            {error && <div className="mt-3"><ErrorNote error={error} /></div>}

            {taught && !error && (
              <p className="mt-2 text-xs text-ink-400">
                {taught === 'labelled'
                  ? 'Logged — this door now trains the model.'
                  : 'Logged. This outcome moves the lead but is not a training label.'}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button tone="primary" onClick={() => setOpen((v) => !v)}>
                {open ? 'Close' : 'Log outcome'}
              </Button>
              <a href={mapsUrl(address)} target="_blank" rel="noreferrer">
                <Button tone="neutral">Navigate</Button>
              </a>
              {lead.contact_phone && (
                <a href={`tel:${lead.contact_phone}`}>
                  <Button tone="neutral">Call</Button>
                </a>
              )}
            </div>

            {open && (
              <div className="mt-3 space-y-3 border-t border-ink-700 pt-3">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Notes for this door (optional)"
                  rows={2}
                  className="w-full rounded-xl border border-ink-600 bg-ink-800 px-3 py-2 outline-none focus:border-cool-500"
                />
                {!outcomes.length ? (
                  <p className="text-sm text-ink-400">Loading outcomes…</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {outcomes.map((o) => (
                      <Button
                        key={o.code}
                        tone={outcomeTone(o.category)}
                        size="lg"
                        disabled={busy}
                        title={o.description ?? undefined}
                        onClick={() => file(o)}
                      >
                        {outcomeLabel(o.code)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </li>
  )
}
