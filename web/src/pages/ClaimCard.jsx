import { useEffect, useState } from 'react'
import { claimKeychain } from '../lib/api.js'
import { Shell } from '../components/ProfileShell.jsx'
import DoctorFields, { EMPTY_DOCTOR, cleanDoctor, validateDoctor } from '../components/DoctorFields.jsx'

/**
 * What someone sees when they tap a keychain nobody has set up yet.
 *
 * Possession of the physical keychain is the only authority needed — there is
 * no staff member in this loop and no password. That is the point of the
 * unguessable code in the URL: it is the credential.
 */
export default function ClaimCard({ slug, number, onClaimed }) {
  const [form, setForm] = useState(EMPTY_DOCTOR)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [claimed, setClaimed] = useState(null)

  useEffect(() => {
    document.title = 'Set up your card · Eqova'
  }, [])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(e) {
    e.preventDefault()

    const problem = validateDoctor(form)
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setSaving(true)
    try {
      const profile = await claimKeychain(slug, cleanDoctor(form))
      setClaimed(profile)
    } catch (err) {
      setError(err.message || 'Could not save your details. Please try again.')
      setSaving(false)
    }
  }

  if (claimed) {
    return (
      <Shell>
        <div className="rounded-3xl bg-white p-8 text-center shadow-xl shadow-brand-900/15">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <svg
              className="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Your card is live</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Anyone who taps this keychain now sees your details. Tap it yourself any time to open
            your card.
          </p>
          <button type="button" className="btn-primary mt-6 w-full" onClick={() => onClaimed(claimed)}>
            View my card
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        <header className="rounded-3xl bg-white p-6 text-center shadow-xl shadow-brand-900/15">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-lg font-bold text-white">
            E
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Set up your digital card</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            This keychain is not linked to anyone yet. Fill in your details and it becomes yours —
            anyone who taps or scans it will see your card.
          </p>
          {number ? (
            <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Keychain <span className="font-mono font-semibold text-slate-700">#{String(number).padStart(3, '0')}</span>
              {' '}— check this matches the number on yours.
            </p>
          ) : null}
        </header>

        <DoctorFields form={form} onChange={update} />

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="card space-y-3 p-5">
          <p className="text-xs leading-relaxed text-slate-500">
            Once you save, this keychain is linked to you. You will not be able to change it
            yourself afterwards — contact the Eqova team if anything needs correcting.
          </p>
          <button type="submit" className="btn-primary w-full !py-3" disabled={saving}>
            {saving ? 'Saving…' : 'Create my card'}
          </button>
        </div>
      </form>
    </Shell>
  )
}

