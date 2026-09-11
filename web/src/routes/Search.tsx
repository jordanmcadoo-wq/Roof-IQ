import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchProperties } from '@/lib/leads'
import type { PropertyHit } from '@/lib/types'
import { compactMoney, relativeDays } from '@/lib/format'
import { Badge, BandBadge, Card, Empty, ErrorNote, Spinner } from '@/components/ui/primitives'

export default function Search() {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<PropertyHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounced: a rep types an address one thumb at a time, and firing a query
  // per keystroke would hammer PostgREST for results nobody reads.
  const q = useDebounced(term, 350)

  useEffect(() => {
    if (q.trim().length < 3) { setHits(null); return }
    let live = true
    setBusy(true); setError(null)
    searchProperties(q)
      .then((r) => live && setHits(r))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setBusy(false))
    return () => { live = false }
  }, [q])

  return (
    <div className="space-y-3 p-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <p className="text-sm text-ink-400">
          Every scored property, not just the launch list
        </p>
      </header>

      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Address or owner name"
        autoComplete="off"
        autoCapitalize="characters"
        className="w-full rounded-xl border border-ink-600 bg-ink-800 px-4 py-3 outline-none focus:border-cool-500"
      />

      {error && <ErrorNote error={error} />}
      {busy && <Spinner label="Searching" />}

      {!busy && hits && hits.length === 0 && (
        <Empty title="No matches" body="Try a house number and street, or the owner's surname." />
      )}

      {!busy && hits && hits.length > 0 && (
        <>
          <p className="text-xs text-ink-400">
            {hits.length}{hits.length === 60 ? '+' : ''} matches
          </p>
          <ul className="space-y-2">
            {hits.map((h) => (
              <li key={h.id}>
                <Link to={`/lead/${h.id}`}>
                  <Card className="p-3 transition active:scale-[0.99]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {h.property_address ?? 'Address unavailable'}
                        </div>
                        <div className="truncate text-xs text-ink-400">
                          {h.owner_name ?? 'Owner unknown'}
                          {h.city ? ` · ${h.city}` : ''}
                        </div>
                      </div>
                      <BandBadge band={h.sales_priority_band} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {h.market_value != null && <Badge>{compactMoney(h.market_value)}</Badge>}
                      {h.latest_storm_at && <Badge tone="warn">Storm {relativeDays(h.latest_storm_at)}</Badge>}
                      {h.lead_status && <Badge tone="go">{h.lead_status.replace(/_/g, ' ')}</Badge>}
                      {h.has_recent_roof_permit === true && <Badge tone="act">Re-roofed</Badge>}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {!hits && !busy && (
        <Empty
          title="Look up any address"
          body="The launch route covers 4,797 doors. This searches the full scored book behind it."
        />
      )}
    </div>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return useMemo(() => v, [v])
}
