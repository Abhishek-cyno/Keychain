import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { fetchKeychain, updateKeychain, profileUrl, getPassword } from '../lib/api.js'
import { AVATARS_ENABLED, avatarUrl, replaceAvatar, removeAvatar } from '../lib/avatar.js'
import Spinner from '../components/Spinner.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import PasswordPrompt from '../components/PasswordPrompt.jsx'
import DoctorFields, { EMPTY_DOCTOR, cleanDoctor, validateDoctor } from '../components/DoctorFields.jsx'

/**
 * Staff correction of a card its owner already created.
 *
 * There is no "assign" path here any more — a blank keychain is filled in by
 * whoever taps it. This screen exists for fixing typos and for the occasional
 * "they changed organisation" request.
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

      {AVATARS_ENABLED && <PhotoSection id={record.id} slug={record.slug} />}

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

/**
 * The photo control on the staff editor.
 *
 * Saves immediately rather than on the form's Save button, and deliberately:
 * the photo does not travel with the other fields. Those go to the sheet and
 * mirror into Postgres; this goes to Supabase Storage and nowhere else. Tying
 * them to one button would suggest they are one write, and a half-failure
 * would be confusing in a way that two obvious actions are not.
 */
function PhotoSection({ id, slug }) {
  const [version, setVersion] = useState(0)
  const [present, setPresent] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const src = avatarUrl(slug, version || undefined)

  async function choose(event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return

    setError('')
    setNote('')
    setBusy('Uploading…')
    try {
      await replaceAvatar(id, getPassword(), file)
      // The filename never changes, so the browser would keep showing the old
      // one without this.
      setVersion(Date.now())
      setPresent(true)
      setNote('Photo updated.')
    } catch (err) {
      setError(err.message || 'Could not update the photo.')
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!window.confirm('Remove this photo? The card falls back to initials.')) return

    setError('')
    setNote('')
    setBusy('Removing…')
    try {
      await removeAvatar(id, getPassword())
      setPresent(false)
      setVersion(Date.now())
      setNote('Photo removed.')
    } catch (err) {
      setError(err.message || 'Could not remove the photo.')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">Photo</h2>

      <div className="mt-4 flex items-center gap-4">
        <div className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-xl font-bold text-brand-700">
          <span className={present ? 'opacity-0' : ''}>—</span>
          <img
            src={src}
            alt=""
            decoding="async"
            className={`absolute inset-0 h-full w-full rounded-full object-cover ${
              present ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setPresent(true)}
            // No file for this keychain. Expected: the absence of the object is
            // how "no photo" is stored.
            onError={() => setPresent(false)}
          />
          {busy && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-white/75">
              <span className="h-5 w-5 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary !py-2 !text-xs"
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={Boolean(busy)}
            >
              {present ? 'Replace photo' : 'Upload photo'}
            </button>
            {present && (
              <button
                type="button"
                className="btn-danger !py-2 !text-xs"
                onClick={remove}
                disabled={Boolean(busy)}
              >
                Remove
              </button>
            )}
          </div>

          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {busy || 'Saved on its own, not with the form below. Resized to 512px before upload.'}
          </p>

          {note && <p className="mt-1 text-xs font-medium text-emerald-600">{note}</p>}
          {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={choose} />
    </section>
  )
}
