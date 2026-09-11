import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { fetchAllLeads } from '@/lib/leads'
import type { RouteLead } from '@/lib/types'
import { shortZone, zoneNumber } from '@/lib/format'
import { Button, ErrorNote, Spinner } from '@/components/ui/primitives'
import SvgCanvas from '@/components/stormmap/SvgCanvas'
import { Legend, SelectedLead, isWorked } from '@/components/stormmap/shared'

/**
 * MapLibre is ~230KB gzipped, which is a lot to push at a rep on cell signal
 * for a tab they may never open. It loads only when a basemap is configured
 * and the map tab is actually rendered.
 */
const GlCanvas = lazy(() => import('@/components/stormmap/GlCanvas'))

/**
 * A MapLibre style JSON URL. Set it and the map gains a street basemap; leave
 * it unset and the projected-points view is used, which needs no tiles at all.
 *
 * The style is the whole contract, so this works with a self-hosted Protomaps
 * style (whose sources may be pmtiles://, handled in GlCanvas) or any hosted
 * style JSON. Nothing here assumes a particular vendor.
 */
const BASEMAP = (import.meta.env.VITE_BASEMAP_URL ?? '').trim()

const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'

export default function StormMap() {
  const [leads, setLeads] = useState<RouteLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zone, setZone] = useState<string | null>(null)
  const [selected, setSelected] = useState<RouteLead | null>(null)

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

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>
  if (!leads) return <Spinner label="Plotting storm exposure" />

  const worked = shown.filter(isWorked).length

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

      {BASEMAP ? (
        <Suspense fallback={<Spinner label="Loading basemap" />}>
          <GlCanvas
            leads={shown}
            styleUrl={BASEMAP}
            selected={selected}
            onSelect={setSelected}
          />
        </Suspense>
      ) : (
        <SvgCanvas leads={shown} selected={selected} onSelect={setSelected} />
      )}

      {selected && <SelectedLead lead={selected} onClose={() => setSelected(null)} />}

      <Legend attribution={BASEMAP ? ATTRIBUTION : undefined} />
    </div>
  )
}
