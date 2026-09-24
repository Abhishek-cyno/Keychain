import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { fetchKeychain, updateKeychain, profileUrl, getPassword } from '../lib/api.js'
import Spinner from '../components/Spinner.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import PasswordPrompt from '../components/PasswordPrompt.jsx'
import DoctorFields, { EMPTY_DOCTOR, cleanDoctor, validateDoctor } from '../components/DoctorFields.jsx'

/**
 * Staff correction of a card its owner already created.
 *
 * There is no "assign" path here any more — a blank keychain is filled in by
 * whoever taps it. This screen exists for fixing typos and for the occasional
 * "they moved hospital" request.
 */
export default function KeychainEditor() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [record, setRecord] = useState(null)
  const [form, setForm] = useState(EMPTY_DOCTOR)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [needsPassword, setNeedsPassword] = useState(!getPassword())

  const load = useCallback(() => {
    setLoading(true)
    setLoadError('')
    fetchKeychain(id).then(
      (data) => {
        setRecord(data)
        setForm({
          ...EMPTY_DOCTOR,
          ...Object.fromEntries(
            Object.entries(data).filter(([, v]) => v !== null && v !== undefined)
          ),
          links: Array.isArray(data.links) ? data.links : [],
        })
        setNotes(data.notes || '')
        setLoading(false)
      },
      (err) => {
        if (err.code === 'UNAUTHORISED') {
          setNeedsPassword(true)
          setLoading(false)
          return
        }
        setLoadError(err.message || 'Could not load this keychain.')
        setLoading(false)
      }
    )
  }, [id])

  useEffect(() => {
    if (needsPassword) {
      setLoading(false)
      return
    }
    load()
  }, [load, needsPassword])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setSaveError('')

    const problem = validateDoctor(form)
    if (problem) {
      setSaveError(problem)
      return
    }

    setSaving(true)
    try {
      await updateKeychain(id, { ...cleanDoctor(form), notes: notes.trim() })
      navigate('/admin', { replace: true })
    } catch (err) {
      setSaveError(err.message || 'Could not save this card.')
      setSaving(false)
    }
  }

  if (needsPassword) {
    return (
      <PasswordPrompt
        body="Viewing and editing a card requires the staff password."
        onUnlocked={() => {
          setNeedsPassword(false)
          setLoading(true)
        }}
        onCancel={() => navigate('/admin')}
      />
    )
  }

  if (loading) return <Spinner label="Loading keychain" />

  if (loadError) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm font-medium text-slate-900">{loadError}</p>
        <Link to="/admin" className="btn-secondary mt-4">
          Back to keychains
        </Link>
      </div>
    )
  }

  if (!record) return null

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5 pb-24">
      <header className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Edit card</p>
            <h1 className="font-mono text-2xl font-bold tabular-nums text-slate-900">
              #{String(record.id).padStart(3, '0')}
            </h1>
          </div>
          <StatusBadge status={record.status} />
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="truncate font-mono text-xs text-slate-600">{profileUrl(record.slug)}</span>
          <a
            href={profileUrl(record.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 text-xs font-semibold text-brand-600 hover:underline"
          >
            Open
          </a>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          This code is printed on the keychain and written to its NFC chip. It never changes — only
          the details below do.
        </p>
      </header>

      <DoctorFields form={form} onChange={update} />

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Internal notes</h2>
        <p className="-mt-1 text-xs text-slate-500">
          Staff only. Never returned by the public profile API, and not visible to the cardholder.
        </p>
        <textarea
          className="input min-h-[70px] resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Corrected phone number on request, 24 Sep"
        />
      </section>

      {saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3">
          <Link to="/admin" className="btn-secondary flex-1 sm:flex-none">
            Cancel
          </Link>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  )
}

