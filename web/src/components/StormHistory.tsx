import type { HailEvent, MrmsDetail, WindExposure } from '@/lib/types'
import { relativeDays } from '@/lib/format'
import { Badge, Card, cx } from '@/components/ui/primitives'

/**
 * Hail size thresholds roofers work to. These are industry rules of thumb for
 * asphalt shingles, not a warranty or an adjuster's ruling - a 1.5" stone on an
 * old brittle roof does more than on a new one, and the adjuster decides. They
 * are here to rank events at a glance, and the labels stay hedged accordingly.
 */
function severity(inches: number | null): { label: string; tone: string; bar: string } {
  const n = inches ?? 0
  if (n >= 2) return { label: 'Severe', tone: 'text-act-400', bar: 'bg-act-500' }
  if (n >= 1.5) return { label: 'Damage likely', tone: 'text-warm-500', bar: 'bg-warm-500' }
  if (n >= 1) return { label: 'Marginal', tone: 'text-cool-500', bar: 'bg-cool-500' }
  return { label: 'Below threshold', tone: 'text-ink-400', bar: 'bg-ink-600' }
}

const SOURCE_NOTE: Record<string, string> = {
  mrms: 'Radar grid — swath covered this parcel',
  swdi: 'Storm cell nearby — attributed, not grid-precise',
}

export function StormHistory({
  events, mrms, wind,
}: { events: HailEvent[]; mrms: MrmsDetail | null; wind: WindExposure | null }) {
  const maxSize = Math.max(...events.map((e) => e.size_inches ?? 0), 1)
  const worst = events.reduce<HailEvent | null>(
    (a, b) => ((b.size_inches ?? 0) > (a?.size_inches ?? 0) ? b : a), null,
  )

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">
          Storm history
        </h2>
        <span className="text-xs text-ink-400">
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      <Card className="divide-y divide-ink-800">
        {mrms && (
          <div className="p-4">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {mrms.direct_intersection === true && (
                <Badge tone="act">Radar swath crossed this parcel</Badge>
              )}
              {mrms.direct_intersection === false && mrms.distance_to_swath_miles != null && (
                <Badge tone="warn">{mrms.distance_to_swath_miles} mi from swath</Badge>
              )}
              {mrms.confidence_label && (
                <Badge>{mrms.confidence_label.replace(/_/g, ' ')}</Badge>
              )}
              {mrms.source_freshness && <Badge>{mrms.source_freshness}</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Fact k="Peak MESH" v={mrms.max_mesh_inches != null ? `${mrms.max_mesh_inches}"` : '—'} />
              <Fact k="Qualifying swaths" v={mrms.qualifying_swath_count ?? '—'} />
              <Fact k="Ground reports" v={mrms.corroborated_report_count ?? '—'} />
              <Fact
                k="Hail duration"
                v={mrms.accumulation_minutes != null ? `${mrms.accumulation_minutes} min` : '—'}
              />
            </dl>
            <p className="mt-2 text-xs text-ink-400">
              MESH is radar-estimated maximum hail size over the grid cell covering
              this parcel.
            </p>
          </div>
        )}

        {events.length === 0 ? (
          <p className="p-4 text-sm text-ink-400">No qualifying hail events recorded.</p>
        ) : (
          <ul>
            {events.map((e, i) => {
              const s = severity(e.size_inches)
              const isWorst = worst != null && e === worst
              return (
                <li key={`${e.event_date}-${e.source}-${i}`} className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-semibold tabular-nums">
                        {e.size_inches != null ? `${e.size_inches}"` : '—'}
                      </span>
                      <span className={cx('ml-2 text-xs', s.tone)}>{s.label}</span>
                      {isWorst && events.length > 1 && (
                        <span className="ml-2 text-xs text-ink-400">worst on record</span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs tabular-nums text-ink-300">
                        {new Date(e.event_date + 'T00:00:00').toLocaleDateString(undefined, {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </div>
                      <div className="text-xs text-ink-400">{relativeDays(e.event_date)}</div>
                    </div>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className={cx('h-full rounded-full', s.bar)}
                      style={{ width: `${Math.max(((e.size_inches ?? 0) / maxSize) * 100, 4)}%` }}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                    <span className="uppercase tracking-wide">{e.source}</span>
                    <span>{SOURCE_NOTE[e.source] ?? ''}</span>
                    {e.distance_miles != null && <span>{e.distance_miles} mi</span>}
                    {e.detection_count != null && e.detection_count > 1 && (
                      <span>{e.detection_count} detections</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {wind?.wind_speed_mph != null && (
          <div className="p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
              Wind
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Fact k="Peak gust" v={`${wind.wind_speed_mph} mph`} />
              <Fact k="Event date" v={wind.event_date ? relativeDays(wind.event_date) : '—'} />
              <Fact k="Distance" v={wind.distance_miles != null ? `${wind.distance_miles} mi` : '—'} />
              <Fact k="Wind events" v={wind.event_count ?? '—'} />
            </dl>
            <p className="mt-2 text-xs text-ink-400">
              Wind reports are points, not footprints, so distance matters more here
              than for hail swaths.
            </p>
          </div>
        )}
      </Card>
    </section>
  )
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  )
}
