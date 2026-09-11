import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'
import { Button, Card, ErrorNote, Spinner } from '@/components/ui/primitives'

type Ctx = { session: Session; profile: Profile | null }
const SessionCtx = createContext<Ctx | null>(null)

export function useSession() {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession used outside AuthGate')
  return ctx
}

/** True when the signed-in user may edit any lead, not just their own. */
export const isManager = (p: Profile | null) =>
  !!p?.role && ['owner', 'admin', 'manager'].includes(p.role)

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase
      .from('profiles')
      .select('id, organization_id, display_name, role, email')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null))
  }, [session])

  if (!ready) return <Spinner label="Checking your session" />
  if (!session) return <SignIn />

  return (
    <SessionCtx.Provider value={{ session, profile }}>
      {children}
    </SessionCtx.Provider>
  )
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">RoofIQ</h1>
        <p className="mt-1 text-sm text-ink-400">Field app</p>
      </div>
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-ink-400">Email</span>
            <input
              type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink-600 bg-ink-800 px-3 py-3 outline-none focus:border-cool-500"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-ink-400">Password</span>
            <input
              type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink-600 bg-ink-800 px-3 py-3 outline-none focus:border-cool-500"
            />
          </label>
          {error && <ErrorNote error={error} />}
          <Button type="submit" tone="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-xs text-ink-400">
        Accounts are created by your manager in Supabase.
      </p>
    </div>
  )
}
