import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchActivities, fetchInsight, fetchProperty, fetchStormSummary,
} from '@/lib/leads'
import type { Activity, AiInsight, PropertyHit } from '@/lib/types'
import { compactMoney, hail, money, relativeDays } from '@/lib/format'
import { mapsUrl } from '@/lib/geo'
import { Badge, BandBadge, Button, Card, ErrorNote, Spinner } from '@/components/ui/primitives'

type Storm = Awaited<ReturnType<typeof fetchStormSummary>>
type Extra = PropertyHit & {
  year_built?: number | null
  roof_age_estimate?: number | null
  roof_type?: string | null
  roof_condition?: string | null
  building_area?: number | null
  owner_occupied?: boolean | null
  contact_phone?: string | null
  contact_name?: string | null
  lead_value_estimate?: number | null
  sales_evidence_quality?: string | null
  last_contacted_at?: string | null
}

export default function LeadDetail() {
  const { id = '' } = useParams()
  const [prop, setProp] = useState<Extra | null>(null)
  const [storm, setStorm] = useState<Storm>(null)
  const [insight, setInsight] = useState<AiInsight | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    Promise.all([
      fetchProperty(id), fetchStormSummary(id), fetchInsight(id), fetchActivities(id),
    ])
      .then(([p, s, i, a]) => {
        if (!live) return
        setProp(p as Extra); setStorm(s); setInsight(i); setActs(a)
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [id])

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (loading) return <Spinner label="Loading lead" />
  if (!prop) return <div className="p-4"><ErrorNote error="That lead is not visible to your account." /></div>

  const address = prop.property_address ?? 'Address unavailable'
  // A mailing address that differs from the site is the classic absentee-owner
  // signal: nobody will answer the door, so the play is a letter or a call.
  const absentee =
    !!prop.mailing_address && !!prop.property_address &&
    !prop.mailing_address.toUpperCase().startsWith(
      prop.property_address.toUpperCase().slice(0, 12),
    )

  return (
    <div className="space-y-4 p-4">
      <Link to="/" className="text-sm text-cool-500">← Back</Link>

      <header>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold leading-tight">{address}</h1>
          <BandBadge band={prop.sales_priority_band} />
        </div>
        <p className="mt-1 text-sm text-ink-400">{prop.owner_name ?? 'Owner unknown'}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {prop.market_value != null && <Badge>{money(prop.market_value)} value</Badge>}
          {prop.sales_action_timing && <Badge tone="warn">{prop.sales_action_timing.replace(/_/g, ' ')}</Badge>}
          {prop.lead_status && <Badge tone="go">{prop.lead_status.replace(/_/g, ' ')}</Badge>}
          {absentee && <Badge tone="warn">Absentee owner</Badge>}
          {prop.owner_occupied === true && <Badge>Owner occupied</Badge>}
          {prop.has_recent_roof_permit === true && <Badge tone="act">Recently re-roofed</Badge>}
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <a href={mapsUrl(address)} target="_blank" rel="noreferrer">
          <Button tone="primary">Navigate</Button>
        </a>
        {prop.contact_phone && (
          <a href={`tel:${prop.contact_phone}`}><Button tone="go">Call {prop.contact_name ?? ''}</Button></a>
        )}
      </div>

      {insight && (
        <Card className="border-cool-500/30 bg-cool-500/5 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-cool-500">
              Model read
            </h2>
            {insight.confidence != null && (
              <Badge>{Math.round(insight.confidence * 100)}% confidence</Badge>
            )}
          </div>
          {insight.summary && <p className="text-sm text-ink-200">{insight.summary}</p>}
          {insight.next_action && (
            <p className="mt-2 text-sm"><span className="text-ink-400">Next:</span> {insight.next_action}</p>
          )}
          {insight.rationale && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-400">Why</summary>
              <p className="mt-1 text-sm text-ink-300">{insight.rationale}</p>
            </details>
          )}
        </Card>
      )}

      <Section title="Storm evidence">
        <Facts rows={[
          ['Max hail', hail(storm?.strongest_hail_inches ?? null)],
          ['Max wind', storm?.strongest_wind_mph != null ? `${storm.strongest_wind_mph} mph` : '—'],
          ['Storms recorded', storm?.storm_event_count ?? '—'],
          ['Most recent', relativeDays(storm?.latest_storm_at ?? prop.latest_storm_at)],
          ['Confidence', storm?.storm_confidence?.replace(/_/g, ' ') ?? '—'],
          ['Nearest report', storm?.nearest_verified_report_miles != null
            ? `${storm.nearest_verified_report_miles} mi` : '—'],
        ]} />
      </Section>

      <Section title="Property">
        <Facts rows={[
          ['Built', prop.year_built ?? '—'],
          ['Roof age est.', prop.roof_age_estimate != null ? `${prop.roof_age_estimate} yrs` : '—'],
          ['Roof type', prop.roof_type ?? '—'],
          ['Condition', prop.roof_condition ?? '—'],
          ['Building area', prop.building_area != null
            ? `${Math.round(prop.building_area).toLocaleString()} sqft` : '—'],
          ['Est. job value', compactMoney(prop.lead_value_estimate)],
          ['Evidence quality', prop.sales_evidence_quality?.replace(/_/g, ' ') ?? '—'],
          ['Last contacted', relativeDays(prop.last_contacted_at)],
        ]} />
      </Section>

      <Section title="Owner">
        <Facts rows={[
          ['Name', prop.owner_name ?? '—'],
          ['Mailing', prop.mailing_address ?? '—'],
        ]} />
      </Section>

      {acts.length > 0 && (
        <Section title={`History (${acts.length})`}>
          <ul className="divide-y divide-ink-800">
            {acts.map((a) => (
              <li key={a.id} className="py-2">
                <div className="text-sm">{a.summary ?? a.activity_type}</div>
                <div className="text-xs text-ink-400">{relativeDays(a.occurred_at)}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-400">{title}</h2>
      <Card className="p-4">{children}</Card>
    </section>
  )
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-ink-400">{k}</dt>
          <dd className="text-sm font-medium capitalize">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
