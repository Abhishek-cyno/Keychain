import { Outlet, Link, useLocation } from 'react-router-dom'
import { USING_MOCK } from '../lib/api.js'

/** Wraps every /admin route. No sign-in — anyone with the URL can manage keychains. */
export default function AdminLayout() {
  const location = useLocation()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/admin" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              E
            </span>
            <span className="text-base font-semibold text-slate-900">Eqova Ops</span>
          </Link>
          <div className="flex items-center gap-2">
            {location.pathname !== '/admin' && (
              <Link to="/admin" className="btn-secondary !py-2 !text-xs">
                All keychains
              </Link>
            )}
          </div>
        </div>
      </header>
      {USING_MOCK && (
        <div className="bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800">
          Demo mode — data is stored in this browser only. Set VITE_API_BASE in web/.env to go live.
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
