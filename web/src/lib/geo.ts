/** Metres between two lat/lon points. */
export function haversineMeters(
  aLat: number, aLon: number, bLat: number, bLon: number,
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Nearest-neighbour walk order, seeded from the highest-value lead.
 *
 * The launch cut's stop_order ignores geography, so a rep crosses their own
 * path repeatedly. This is a greedy tour: not optimal, but it removes the
 * pathological back-and-forth and runs instantly on a phone for a few hundred
 * stops. Leads without coordinates keep their original order at the end.
 */
export function optimizeWalkOrder<T extends { lat: number | null; lon: number | null }>(
  leads: T[],
  score: (lead: T) => number,
): T[] {
  const located = leads.filter((l) => l.lat != null && l.lon != null)
  const unlocated = leads.filter((l) => l.lat == null || l.lon == null)
  if (located.length <= 2) return [...located, ...unlocated]

  const remaining = [...located]
  let current = remaining.reduce((best, l) => (score(l) > score(best) ? l : best))
  remaining.splice(remaining.indexOf(current), 1)
  const ordered = [current]

  while (remaining.length) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMeters(
        current.lat!, current.lon!, remaining[i].lat!, remaining[i].lon!,
      )
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    current = remaining.splice(bestIdx, 1)[0]
    ordered.push(current)
  }
  return [...ordered, ...unlocated]
}

/** Total walking distance of a route, in miles. */
export function routeMiles<T extends { lat: number | null; lon: number | null }>(
  leads: T[],
): number {
  let m = 0
  for (let i = 1; i < leads.length; i++) {
    const a = leads[i - 1], b = leads[i]
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue
    m += haversineMeters(a.lat, a.lon, b.lat, b.lon)
  }
  return m / 1609.344
}

export const mapsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
