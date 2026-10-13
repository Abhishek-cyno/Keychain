import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { USING_MOCK, getPassword, clearPassword } from '../lib/api.js'
import PasswordPrompt from './PasswordPrompt.jsx'

/**
 * Wraps every /admin route, behind the staff password.
 *
 * The gate is here rather than on each page so there is one of it. Anything
 * added under /admin later is covered without having to remember — and the
 * dashboard used to be reachable by URL alone, which made the password on the
 * editor a lock on an interior door.
 *
 * The password is verified against the API before anything renders, not merely
 * compared here, so a wrong one is refused by the server rather than by code
 * sitting in the browser where anyone can read it. It is held in
 * sessionStorage, so closing the tab locks up again.
 */
export default function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [locked, setLocked] = useState(() => !getPassword())

  if (locked) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PasswordPrompt
          title="Eqova Ops"
          body="The staff dashboard requires the password."
          onUnlocked={() => setLocked(false)}
          onCancel={() => navigate('/')}
        />
      </div>
    )
  }

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
            {/* Shared laptops at an event: leaving the session open until the
                tab happens to close is not good enough. */}
            <button
              type="button"
              className="btn-secondary !py-2 !text-xs"
              onClick={() => {
                clearPassword()
                setLocked(true)
              }}
            >
              Lock
            </button>
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
