import type { ReactNode, ButtonHTMLAttributes } from 'react'

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ')

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'go' | 'act' | 'neutral' | 'muted' | 'primary'
  size?: 'md' | 'lg'
}

const TONES: Record<string, string> = {
  primary: 'bg-cool-500 text-ink-950 hover:brightness-110 active:brightness-95',
  go:      'bg-go-500 text-ink-950 hover:brightness-110 active:brightness-95',
  act:     'bg-act-500 text-white hover:brightness-110 active:brightness-95',
  neutral: 'bg-ink-700 text-ink-50 hover:bg-ink-600 active:bg-ink-700',
  muted:   'bg-transparent text-ink-300 border border-ink-600 hover:bg-ink-800',
}

export function Button({
  tone = 'neutral', size = 'md', className, ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'rounded-xl font-semibold transition select-none',
        'disabled:opacity-40 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cool-500',
        // 48px min target: this is tapped with one thumb, often gloved.
        size === 'lg' ? 'min-h-14 px-5 text-base' : 'min-h-12 px-4 text-sm',
        TONES[tone],
        className,
      )}
    />
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx(
      'rounded-2xl bg-ink-900 border border-ink-700/70 shadow-lg shadow-black/30',
      className,
    )}>
      {children}
    </div>
  )
}

const BAND_TONE: Record<string, string> = {
  A1: 'bg-act-500/15 text-act-400 border-act-500/40',
  A2: 'bg-warm-500/15 text-warm-500 border-warm-500/40',
  B1: 'bg-cool-500/15 text-cool-500 border-cool-500/40',
  B2: 'bg-cool-500/10 text-cool-500/80 border-cool-500/25',
}

export function BandBadge({ band }: { band: string | null }) {
  if (!band) return null
  return (
    <span className={cx(
      'inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-bold tracking-wide',
      BAND_TONE[band] ?? 'bg-ink-700 text-ink-300 border-ink-600',
    )}>
      {band}
    </span>
  )
}

export function Badge({
  children, tone = 'neutral',
}: { children: ReactNode; tone?: 'neutral' | 'go' | 'act' | 'warn' }) {
  const tones = {
    neutral: 'bg-ink-800 text-ink-300 border-ink-700',
    go:      'bg-go-500/15 text-go-400 border-go-500/40',
    act:     'bg-act-500/15 text-act-400 border-act-500/40',
    warn:    'bg-warm-500/15 text-warm-500 border-warm-500/40',
  }
  return (
    <span className={cx(
      'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium',
      tones[tone],
    )}>
      {children}
    </span>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-400">{hint}</div>}
    </Card>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-400" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-ink-600 border-t-cool-500" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="py-16 text-center">
      <p className="font-semibold text-ink-200">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-400">{body}</p>}
    </div>
  )
}

export function ErrorNote({ error }: { error: string }) {
  return (
    <div role="alert" className="rounded-xl border border-act-500/40 bg-act-500/10 p-3 text-sm text-act-400">
      {error}
    </div>
  )
}
