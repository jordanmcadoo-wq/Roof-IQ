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
 * An explicit MapLibre style URL, for a hosted basemap. Usually unset.
 */
const BASEMAP_OVERRIDE = (import.meta.env.VITE_BASEMAP_URL ?? '').trim()

/**
 * The self-hosted pair. style.json is committed and ready; the archive is not,
 * because it is ~100MB of OSM extract that does not belong in git.
 *
 * Drop okc.pmtiles into web/public/basemap/ and the map upgrades itself on the
 * next deploy - no env var, no rebuild flag. Detection is a HEAD against the
 * archive, which the server answers 404 for when absent (/basemap/ is excluded
 * from the SPA fallback precisely so this probe means something).
 */
const LOCAL_ARCHIVE = '/basemap/okc.pmtiles'
const LOCAL_STYLE = '/basemap/style.json'

function useBasemap(): { style: string | null; checked: boolean } {
  const [style, setStyle] = useState<string | null>(BASEMAP_OVERRIDE || null)
  const [checked, setChecked] = useState(!!BASEMAP_OVERRIDE)

  useEffect(() => {
    if (BASEMAP_OVERRIDE) return
    let live = true
    fetch(LOCAL_ARCHIVE, { method: 'HEAD' })
      .then((r) => { if (live && r.ok) setStyle(LOCAL_STYLE) })
      .catch(() => {})
      .finally(() => { if (live) setChecked(true) })
    return () => { live = false }
  }, [])

  return { style, checked }
}

// Natural Earth is public domain and needs no attribution; OSM is ODbL and
// does, so the notice stands whenever either layer is drawn.
const ATTRIBUTION = 'Roads: Natural Earth (public domain). Basemap, when enabled: © OpenStreetMap contributors (ODbL).'

export default function StormMap() {
  const { style: basemap, checked } = useBasemap()
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

      {/* Until the probe answers, draw the tile-free canvas rather than a
          spinner: it needs nothing but the rows already in hand, so the map is
          usable immediately and only swaps if an archive is actually there. */}
      {checked && basemap ? (
        <Suspense fallback={<SvgCanvas leads={shown} selected={selected} onSelect={setSelected} />}>
          <GlCanvas
            leads={shown}
            styleUrl={basemap}
            selected={selected}
            onSelect={setSelected}
          />
        </Suspense>
      ) : (
        <SvgCanvas leads={shown} selected={selected} onSelect={setSelected} />
      )}

      {selected && <SelectedLead lead={selected} onClose={() => setSelected(null)} />}

      <Legend attribution={ATTRIBUTION} />
    </div>
  )
}
