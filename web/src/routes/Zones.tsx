import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAllLeads } from '@/lib/leads'
import type { RouteLead } from '@/lib/types'
import { compactMoney, shortZone, zoneNumber } from '@/lib/format'
import { BandBadge, Card, Empty, ErrorNote, Spinner } from '@/components/ui/primitives'

type ZoneRow = {
  zone: string
  city: string | null
  leads: number
  a1: number
  worked: number
  pipeline: number
  topBand: string | null
}

const WORKED = new Set([
  'knocked', 'contact_made', 'inspection_set', 'inspection_scheduled',
  'inspection_complete', 'estimate_sent', 'estimate', 'claim_filed',
  'contract_signed', 'sold', 'lost', 'not_qualified', 'do_not_contact',
])

export default function Zones() {
  const [leads, setLeads] = useState<RouteLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAllLeads().then(setLeads).catch((e) => setError(e.message))
  }, [])

  const zones = useMemo<ZoneRow[]>(() => {
    if (!leads) return []
    const by = new Map<string, ZoneRow>()
    for (const l of leads) {
      let z = by.get(l.zone_name)
      if (!z) {
        z = { zone: l.zone_name, city: l.zone_city, leads: 0, a1: 0, worked: 0, pipeline: 0, topBand: null }
        by.set(l.zone_name, z)
      }
      z.leads++
      if (l.band === 'A1') z.a1++
      if (l.lead_status && WORKED.has(l.lead_status)) z.worked++
      z.pipeline += l.market_value ?? 0
      if (!z.topBand || (l.band ?? 'Z') < z.topBand) z.topBand = l.band
    }
    return [...by.values()].sort((a, b) => zoneNumber(a.zone) - zoneNumber(b.zone))
  }, [leads])

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (!leads) return <Spinner label="Loading your zones" />
  if (!zones.length) return <Empty title="No zones yet" body="Nothing in the launch cut is visible to your account." />

  return (
    <div className="space-y-3 p-4">
      <header className="pb-1">
        <h1 className="text-2xl font-bold tracking-tight">Zones</h1>
        <p className="text-sm text-ink-400">
          {zones.length} zones · {leads.length.toLocaleString()} doors
        </p>
      </header>

      {zones.map((z) => {
        const pct = z.leads ? Math.round((z.worked / z.leads) * 100) : 0
        return (
          <Link key={z.zone} to={`/zone/${encodeURIComponent(z.zone)}`} className="block">
            <Card className="p-4 transition active:scale-[0.99]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{shortZone(z.zone)}</div>
                  <div className="mt-0.5 text-xs text-ink-400">
                    {z.leads} doors · {z.a1} A1 · {compactMoney(z.pipeline)} pipeline
                  </div>
                </div>
                <BandBadge band={z.topBand} />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-go-500 transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-ink-400">
                  {pct}% done
                </span>
              </div>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
