import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchFollowups } from '@/lib/leads'
import type { LeadTask, Opportunity } from '@/lib/types'
import { compactMoney } from '@/lib/format'
import { Badge, Card, Empty, ErrorNote, Spinner } from '@/components/ui/primitives'

type Row = {
  key: string
  propertyId: string
  when: string | null
  title: string
  detail: string | null
  value: number | null
  kind: 'appointment' | 'inspection' | 'action' | 'task'
}

export default function Followups() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchFollowups>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchFollowups().then(setData).catch((e) => setError(e.message))
  }, [])

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    const out: Row[] = []

    for (const o of data.opportunities as (Opportunity & { address?: string | null })[]) {
      // One opportunity can carry several dates. Each is its own thing a rep
      // has to show up for, so they get separate rows rather than one blended
      // "next" that hides the appointment behind a follow-up call.
      const add = (when: string | null, kind: Row['kind'], title: string) => {
        if (!when) return
        out.push({
          key: `${o.id}-${kind}`, propertyId: o.property_id, when, kind, title,
          detail: o.address ?? null, value: o.estimated_contract_value,
        })
      }
      add(o.appointment_at, 'appointment', 'Appointment')
      add(o.inspection_at, 'inspection', 'Inspection')
      add(o.next_action_at, 'action', o.next_action_type?.replace(/_/g, ' ') ?? 'Follow up')
    }

    for (const t of data.tasks as (LeadTask & { address?: string | null })[]) {
      out.push({
        key: t.id, propertyId: t.property_id, when: t.due_at, kind: 'task',
        title: t.title ?? 'Task', detail: t.address ?? t.description, value: null,
      })
    }

    // Undated rows are kept rather than filtered out. Only 2 of 52 open tasks
    // currently carry a due date, so dropping the rest would show an almost
    // empty page while real work sat invisible.
    return out.sort((a, b) => {
      if (!a.when && !b.when) return 0
      if (!a.when) return 1
      if (!b.when) return -1
      return new Date(a.when).getTime() - new Date(b.when).getTime()
    })
  }, [data])

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (!data) return <Spinner label="Loading follow-ups" />

  const now = Date.now()
  const overdue = rows.filter((r) => r.when && new Date(r.when).getTime() < now)
  const upcoming = rows.filter((r) => r.when && new Date(r.when).getTime() >= now)
  const undated = rows.filter((r) => !r.when)

  return (
    <div className="space-y-5 p-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-ink-400">
          {overdue.length} overdue · {upcoming.length} upcoming
          {undated.length > 0 && ` · ${undated.length} unscheduled`}
        </p>
      </header>

      {rows.length === 0 && (
        <Empty
          title="Nothing scheduled"
          body="Appointments, inspections and tasks with a due date show up here."
        />
      )}

      {overdue.length > 0 && <Group title="Overdue" rows={overdue} overdue />}
      {upcoming.length > 0 && <Group title="Upcoming" rows={upcoming} />}
      {undated.length > 0 && <Group title="No due date" rows={undated} />}
    </div>
  )
}

function Group({ title, rows, overdue }: { title: string; rows: Row[]; overdue?: boolean }) {
  return (
    <section>
      <h2 className={`mb-2 text-sm font-semibold uppercase tracking-wider ${
        overdue ? 'text-act-400' : 'text-ink-400'
      }`}>
        {title}
      </h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key}>
            <Link to={`/lead/${r.propertyId}`}>
              <Card className={`p-3 transition active:scale-[0.99] ${
                overdue ? 'border-act-500/40' : ''
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold capitalize">{r.title}</div>
                    <div className="truncate text-xs text-ink-400">{r.detail ?? '—'}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-xs tabular-nums ${overdue ? 'text-act-400' : 'text-ink-300'}`}>
                      {r.when
                        ? new Date(r.when).toLocaleDateString(undefined, {
                            month: 'short', day: 'numeric',
                          })
                        : 'unscheduled'}
                    </div>
                    {r.value != null && (
                      <div className="text-xs text-ink-400">{compactMoney(r.value)}</div>
                    )}
                  </div>
                </div>
                <div className="mt-2"><Badge>{r.kind}</Badge></div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
