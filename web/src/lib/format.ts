const usd = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
})

export const money = (n: number | null | undefined) =>
  n == null ? '—' : usd.format(n)

export const compactMoney = (n: number | null | undefined) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
        notation: 'compact', maximumFractionDigits: 1,
      }).format(n)

export const hail = (inches: number | null | undefined) =>
  inches == null ? '—' : `${inches}"`

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

export function relativeDays(iso: string | null | undefined): string {
  const d = daysSince(iso)
  if (d == null) return 'never'
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

/** "OKC Launch · Zone 08 · Oklahoma City" -> "Zone 08 · Oklahoma City" */
export const shortZone = (zone: string) =>
  zone.replace(/^OKC Launch\s*·\s*/i, '')

export const zoneNumber = (zone: string): number => {
  const m = zone.match(/Zone\s+(\d+)/i)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}
