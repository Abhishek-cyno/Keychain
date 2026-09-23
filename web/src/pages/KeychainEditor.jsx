import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { fetchKeychain, assignKeychain, updateKeychain, profileUrl } from '../lib/api.js'
import Spinner from '../components/Spinner.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

const SPECIALIZATIONS = [
  'Anaesthesiologist',
  'Biochemistry',
  'Cardiology',
  'Casualty/Emergency',
  'Critical Care',
  'Dermatologist',
  'ENT',
  'Forensics',
  'Gastroenterology',
  'Geriatric Care',
  'Gynae and Obs',
  'Haematology',
  'Medicine/Physician',
  'Microbiologist',
  'Nephrologist',
  'Neurologist',
  'Oncology',
  'Ophthalmologist',
  'Orthopaedics',
  'OTT',
  'Paediatrician',
  'Pathology',
  'Pharmacology',
  'Psychiatry & Psychology',
  'Pulmonology & Respiratory',
  'Public Health',
  'Radiology',
  'Sports Medicine',
  'Surgeon/Plastic Surgeon',
  'Urology',
]

const DESIGNATIONS = [
  'Intern',
  'Junior Resident',
  'Senior Resident',
  'Registrar',
  'Fellow',
  'Medical Officer',
  'Associate Consultant',
  'Consultant',
  'Senior Consultant',
  'Assistant Professor',
  'Associate Professor',
  'Professor',
  'HOD',
  'Medical Superintendent',
  'Chief Medical Officer',
]

const EMPTY = {
  name: '',
  specialization: '',
  hospital: '',
  designation: '',
  phone: '',
  email: '',
  bio: '',
  linkedin: '',
  website: '',
  links: [],
  notes: '',
}

export default function KeychainEditor() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [record, setRecord] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchKeychain(id).then(
      (data) => {
        if (cancelled) return
        setRecord(data)
        setForm({ ...EMPTY, ...stripNulls(data), links: Array.isArray(data.links) ? data.links : [] })
        setLoading(false)
      },
      (err) => {
        if (cancelled) return
        setLoadError(err.message || 'Could not load this keychain.')
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [id])

  const isNew = record && !record.assigned && record.status === 'AVAILABLE'

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setSaveError('')

    if (!form.name.trim()) {
      setSaveError('Doctor name is required.')
      return
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setSaveError('That email address does not look right.')
      return
    }

    const payload = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      links: (form.links || []).filter((l) => l && l.url && l.url.trim()),
    }

    setSaving(true)
    try {
      if (isNew) {
        await assignKeychain(id, payload)
      } else {
        await updateKeychain(id, payload)
      }
      navigate('/admin', { replace: true })
    } catch (err) {
      if (err.code === 'CONFLICT') {
        setSaveError(
          `Keychain #${id} was just taken by another staff member. Nothing was saved — pick a different keychain.`
        )
      } else {
        setSaveError(err.message || 'Could not save this profile.')
      }
      setSaving(false)
    }
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

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5 pb-24">
      <header className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {isNew ? 'Assign keychain' : 'Edit profile'}
            </p>
            <h1 className="font-mono text-2xl font-bold tabular-nums text-slate-900">
              #{String(record.id).padStart(3, '0')}
            </h1>
          </div>
          <StatusBadge status={record.status} />
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="truncate font-mono text-xs text-slate-600">{profileUrl(record.id)}</span>
          <a
            href={profileUrl(record.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 text-xs font-semibold text-brand-600 hover:underline"
          >
            Open
          </a>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          This URL is printed on the keychain and written to its NFC chip. It never changes — only the details below do.
        </p>
      </header>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Professional details</h2>

        <Field label="Doctor name" required>
          <input
            className="input"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Dr. Amit Sharma"
            autoFocus={isNew}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Specialization">
            <Combobox
              value={form.specialization}
              onChange={(value) => update('specialization', value)}
              options={SPECIALIZATIONS}
              placeholder="Search or type a specialization"
            />
          </Field>
          <Field label="Designation">
            <Combobox
              value={form.designation}
              onChange={(value) => update('designation', value)}
              options={DESIGNATIONS}
              placeholder="Search or type a designation"
            />
          </Field>
        </div>

        <Field label="Hospital / organization">
          <input
            className="input"
            value={form.hospital}
            onChange={(e) => update('hospital', e.target.value)}
            placeholder="ABC Hospital"
          />
        </Field>

        <Field label="About" hint="Shown under the doctor's name on the public profile.">
          <textarea
            className="input min-h-[110px] resize-y"
            value={form.bio}
            onChange={(e) => update('bio', e.target.value)}
            placeholder="Short professional bio"
          />
        </Field>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Contact</h2>
        <p className="-mt-2 text-xs text-slate-500">
          Only enter details the doctor is happy to show publicly on their profile.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="+91 98765 43210"
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="doctor@example.com"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="LinkedIn">
            <input
              className="input"
              value={form.linkedin}
              onChange={(e) => update('linkedin', e.target.value)}
              placeholder="linkedin.com/in/…"
            />
          </Field>
          <Field label="Website">
            <input
              className="input"
              value={form.website}
              onChange={(e) => update('website', e.target.value)}
              placeholder="example.com"
            />
          </Field>
        </div>

        <ExtraLinks value={form.links} onChange={(links) => update('links', links)} />
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Internal notes</h2>
        <p className="-mt-2 text-xs text-slate-500">
          Staff-only. Never returned by the public profile API.
        </p>
        <textarea
          className="input min-h-[70px] resize-y"
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          placeholder="Booth 3, handed over by Priya"
        />
      </section>

      {saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3">
          <Link to="/admin" className="btn-secondary flex-1 sm:flex-none">
            Cancel
          </Link>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Save & activate' : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Combobox({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const query = value || ''
  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  function pick(option) {
    onChange(option)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        className="input"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.map((option) => (
            <li key={option}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(option)
                }}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExtraLinks({ value, onChange }) {
  const links = value || []

  function set(index, patch) {
    onChange(links.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  return (
    <div>
      <label className="label">Other links</label>
      <div className="space-y-2">
        {links.map((link, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="input w-1/3"
              value={link.label || ''}
              onChange={(e) => set(index, { label: e.target.value })}
              placeholder="Label"
            />
            <input
              className="input flex-1"
              value={link.url || ''}
              onChange={(e) => set(index, { url: e.target.value })}
              placeholder="https://…"
            />
            <button
              type="button"
              className="btn-secondary !px-3"
              onClick={() => onChange(links.filter((_, i) => i !== index))}
              aria-label="Remove link"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 text-sm font-semibold text-brand-600 hover:underline"
        onClick={() => onChange([...links, { label: '', url: '' }])}
      >
        + Add link
      </button>
    </div>
  )
}

function stripNulls(obj) {
  const out = {}
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined) out[k] = v
  })
  return out
}
