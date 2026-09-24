import { useState } from 'react'
import { verifyPassword, setPassword, USING_MOCK } from '../lib/api.js'

/**
 * Asks for the staff password, verifies it against the API, and remembers it
 * for the rest of the browser session.
 *
 * Verifying here rather than on first use means a wrong password is reported
 * immediately, instead of surfacing halfway through saving someone's card.
 */
export default function PasswordPrompt({ title = 'Staff password', body, onUnlocked, onCancel }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await verifyPassword(value.trim())
      setPassword(value.trim())
      onUnlocked()
    } catch (err) {
      setError(err.message || 'That password was not accepted.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {body || 'Editing a card requires the staff password.'}
        </p>

        <input
          className="input mt-4"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
        />

        {USING_MOCK && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Demo mode — the password is <span className="font-mono font-semibold">demo</span>.
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={busy || !value.trim()}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  )
}
