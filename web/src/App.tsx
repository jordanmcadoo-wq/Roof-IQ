import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGate, useSession } from '@/components/Session'
import { supabase } from '@/lib/supabase'
import Zones from '@/routes/Zones'
import RouteView from '@/routes/RouteView'
import Dashboard from '@/routes/Dashboard'
import LeadDetail from '@/routes/LeadDetail'
import Search from '@/routes/Search'
import Followups from '@/routes/Followups'
import StormMap from '@/routes/StormMap'
import { cx } from '@/components/ui/primitives'

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Shell />
      </AuthGate>
    </BrowserRouter>
  )
}

function Shell() {
  const { profile, session } = useSession()
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {profile?.display_name ?? session.user.email}
          </div>
          {profile?.role && (
            <div className="text-xs capitalize text-ink-400">{profile.role}</div>
          )}
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-ink-400 underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </div>

      <main className="flex-1 pb-24">
        <Routes>
          <Route path="/" element={<Zones />} />
          <Route path="/zone/:zone" element={<RouteView />} />
          <Route path="/lead/:id" element={<LeadDetail />} />
          <Route path="/map" element={<StormMap />} />
          <Route path="/search" element={<Search />} />
          <Route path="/followups" element={<Followups />} />
          <Route path="/pipeline" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-ink-800 bg-ink-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl">
          <Tab to="/" label="Route" />
          <Tab to="/map" label="Map" />
          <Tab to="/search" label="Search" />
          <Tab to="/followups" label="Follow-ups" />
          <Tab to="/pipeline" label="Pipeline" />
        </div>
      </nav>
    </div>
  )
}

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cx(
          'flex-1 py-4 text-center text-sm font-semibold transition',
          'pb-[max(1rem,env(safe-area-inset-bottom))]',
          isActive ? 'text-cool-500' : 'text-ink-400',
        )
      }
    >
      {label}
    </NavLink>
  )
}
