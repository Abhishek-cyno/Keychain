/**
 * The fields that make up a card, shared by the public claim form and the
 * staff editor so the two can never drift apart.
 */

export const EMPTY_DOCTOR = {
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
}

export function Field({ label, hint, required, children }) {
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

export default function DoctorFields({ form, onChange }) {
  const set = (field) => (e) => onChange(field, e.target.value)

  return (
    <>
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Professional details</h2>

        <Field label="Full name" required>
          <input
            className="input"
            value={form.name}
            onChange={set('name')}
            placeholder="Dr. Amit Sharma"
            autoComplete="name"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Specialization">
            <input
              className="input"
              value={form.specialization}
              onChange={set('specialization')}
              placeholder="Cardiologist"
            />
          </Field>
          <Field label="Designation">
            <input
              className="input"
              value={form.designation}
              onChange={set('designation')}
              placeholder="Senior Consultant"
            />
          </Field>
        </div>

        <Field label="Hospital / organization">
          <input
            className="input"
            value={form.hospital}
            onChange={set('hospital')}
            placeholder="ABC Hospital"
            autoComplete="organization"
          />
        </Field>

        <Field label="About" hint="A short professional bio, shown under your name.">
          <textarea
            className="input min-h-[110px] resize-y"
            value={form.bio}
            onChange={set('bio')}
            placeholder="Interventional cardiologist with 18 years of experience…"
          />
        </Field>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Contact</h2>
        <p className="-mt-2 text-xs text-slate-500">
          Anything you fill in here is shown publicly to anyone who taps this keychain. Leave a
          field blank to keep it off your card.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+91 98765 43210"
              autoComplete="tel"
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="LinkedIn">
            <input
              className="input"
              value={form.linkedin}
              onChange={set('linkedin')}
              placeholder="linkedin.com/in/…"
            />
          </Field>
          <Field label="Website">
            <input
              className="input"
              value={form.website}
              onChange={set('website')}
              placeholder="example.com"
            />
          </Field>
        </div>

        <ExtraLinks value={form.links} onChange={(links) => onChange('links', links)} />
      </section>
    </>
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
      {links.length < 8 && (
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-brand-600 hover:underline"
          onClick={() => onChange([...links, { label: '', url: '' }])}
        >
          + Add link
        </button>
      )}
    </div>
  )
}

/** Trim and drop empty links before sending. */
export function cleanDoctor(form) {
  return {
    ...form,
    name: form.name.trim(),
    specialization: form.specialization.trim(),
    hospital: form.hospital.trim(),
    designation: form.designation.trim(),
    phone: form.phone.trim(),
    email: form.email.trim(),
    bio: form.bio.trim(),
    linkedin: form.linkedin.trim(),
    website: form.website.trim(),
    links: (form.links || []).filter((l) => l && l.url && l.url.trim()),
  }
}

export function validateDoctor(form) {
  if (!form.name.trim()) return 'Please enter your name.'
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return 'That email address does not look right.'
  }
  return ''
}
