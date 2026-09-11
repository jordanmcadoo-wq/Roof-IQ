import { useEffect, useMemo, useState } from 'react'
import { fetchAllLeads } from '@/lib/leads'
import type { RouteLead } from '@/lib/types'
import { compactMoney, shortZone } from '@/lib/format'
import { Card, ErrorNote, Spinner, Stat } from '@/components/ui/primitives'

const WORKED = new Set([
  'knocked', 'contact_made', 'inspection_set', 'inspection_scheduled',
  'inspection_complete', 'estimate_sent', 'estimate', 'claim_filed',
  'contract_signed', 'sold', 'lost', 'not_qualified', 'do_not_contact',
])
const CONTACTED = new Set([
  'contact_made', 'inspection_set', 'inspection_scheduled', 'inspection_complete',
  'estimate_sent', 'estimate', 'claim_filed', 'contract_signed', 'sold',
])

export default function Dashboard() {
  const [leads, setLeads] = useState<RouteLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllLeads().then(setLeads).catch((e) => setError(e.message))
  }, [])

  const m = useMemo(() => {
    if (!leads) return null
    const worked = leads.filter((l) => l.lead_status && WORKED.has(l.lead_status)).length
    const contacted = leads.filter((l) => l.lead_status && CONTACTED.has(l.lead_status)).length
    const sold = leads.filter((l) => l.lead_status === 'sold').length
    const inspections = leads.filter(
      (l) => l.lead_status === 'inspection_set' || l.lead_status === 'inspection_scheduled',
    ).length
    return {
      total: leads.length,
      a1: leads.filter((l) => l.band === 'A1').length,
      pipeline: leads.reduce((s, l) => s + (l.market_value ?? 0), 0),
      worked, contacted, sold, inspections,
      contactRate: worked ? Math.round((contacted / worked) * 100) : 0,
      reroofed: leads.filter((l) => l.has_recent_roof_permit === true).length,
    }
  }, [leads])

  const byZone = useMemo(() => {
    if (!leads) return []
    const by = new Map<string, { zone: string; leads: number; a1: number; pipeline: number; worked: number }>()
    for (const l of leads) {
      let z = by.get(l.zone_name)
      if (!z) { z = { zone: l.zone_name, leads: 0, a1: 0, pipeline: 0, worked: 0 }; by.set(l.zone_name, z) }
      z.leads++
      if (l.band === 'A1') z.a1++
      if (l.lead_status && WORKED.has(l.lead_status)) z.worked++
      z.pipeline += l.market_value ?? 0
    }
    return [...by.values()].sort((a, b) => b.pipeline - a.pipeline)
  }, [leads])

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (!leads || !m) return <Spinner label="Crunching the pipeline" />

  const maxPipeline = Math.max(...byZone.map((z) => z.pipeline), 1)

  return (
    <div className="space-y-5 p-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
        <p className="text-sm text-ink-400">{byZone.length} zones in the launch cut</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Live doors" value={m.total.toLocaleString()} hint={`${m.a1} A1`} />
        <Stat label="Pipeline" value={compactMoney(m.pipeline)} hint="assessor market value" />
        <Stat label="Doors worked" value={m.worked.toLocaleString()}
              hint={`${Math.round((m.worked / m.total) * 100)}% of list`} />
        <Stat label="Contact rate" value={`${m.contactRate}%`} hint={`${m.contacted} conversations`} />
        <Stat label="Inspections" value={m.inspections} />
        <Stat label="Sold" value={m.sold} />
      </div>

      {m.reroofed > 0 && (
        <Card className="border-act-500/40 bg-act-500/5 p-4">
          <div className="font-semibold text-act-400">
            {m.reroofed.toLocaleString()} doors already re-roofed
          </div>
          <p className="mt-1 text-sm text-ink-300">
            A permit says the roof was replaced. These are marked skip in the route —
            knocking them burns time for nothing.
          </p>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-400">
          Zones by pipeline
        </h2>
        <Card className="divide-y divide-ink-700/70">
          {byZone.map((z) => (
            <div key={z.zone} className="p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{shortZone(z.zone)}</span>
                <span className="shrink-0 text-sm tabular-nums text-ink-300">
                  {compactMoney(z.pipeline)}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-cool-500"
                  style={{ width: `${(z.pipeline / maxPipeline) * 100}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-ink-400">
                {z.leads} doors · {z.a1} A1 · {z.worked} worked
              </div>
            </div>
          ))}
        </Card>
      </section>

      <p className="pb-2 text-center text-xs text-ink-400">
        Sorted by pipeline value. Zone numbers follow the launch cut
        ({byZone.length ? shortZone(byZone[0].zone) : ''} leads on value, not sequence).
      </p>
    </div>
  )
}
