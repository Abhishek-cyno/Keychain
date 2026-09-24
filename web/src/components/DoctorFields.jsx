/**
 * The fields that make up a card, shared by the public claim form and the
 * staff editor so the two can never drift apart.
 */

export const EMPTY_DOCTOR = {
  title: '',
  name: '',
  designation: '',
  organization: '',
  email: '',
  mobile: '',
  phone: '',
  website: '',
  address: '',
  remarks: '',
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
        <h2 className="text-sm font-semibold text-slate-900">Your details</h2>

        <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
          <Field label="Title">
            <input
              className="input"
              value={form.title}
              onChange={set('title')}
              placeholder="Dr."
              autoComplete="honorific-prefix"
            />
          </Field>
          <Field label="Name" required>
            <input
              className="input"
              value={form.name}
              onChange={set('name')}
              placeholder="Amit Sharma"
              autoComplete="name"
            />
          </Field>
        </div>

        <Field label="Designation">
          <input
            className="input"
            value={form.designation}
            onChange={set('designation')}
            placeholder="Senior Consultant"
            autoComplete="organization-title"
          />
        </Field>

        <Field label="Organisation">
          <input
            className="input"
            value={form.organization}
            onChange={set('organization')}
            placeholder="ABC Hospital"
            autoComplete="organization"
          />
        </Field>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Contact</h2>
        <p className="-mt-2 text-xs text-slate-500">
          Anything you fill in here is shown publicly to anyone who taps this keychain. Leave a
          field blank to keep it off your card.
        </p>

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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={form.mobile}
              onChange={set('mobile')}
              placeholder="+91 98765 43210"
              autoComplete="tel"
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="Landline or office"
            />
          </Field>
        </div>

        <Field label="Website">
          <input
            className="input"
            value={form.website}
            onChange={set('website')}
            placeholder="example.com"
            autoComplete="url"
          />
        </Field>

        <Field label="Address">
          <textarea
            className="input min-h-[80px] resize-y"
            value={form.address}
            onChange={set('address')}
            placeholder="Clinic or office address"
            autoComplete="street-address"
          />
        </Field>

        <Field label="Remarks" hint="Anything else you would like on your card.">
          <textarea
            className="input min-h-[80px] resize-y"
            value={form.remarks}
            onChange={set('remarks')}
            placeholder="Optional"
          />
        </Field>
      </section>
    </>
  )
}

/** Trim everything before sending. */
export function cleanDoctor(form) {
  const out = {}
  Object.keys(EMPTY_DOCTOR).forEach((field) => {
    out[field] = String(form[field] || '').trim()
  })
  return out
}

export function validateDoctor(form) {
  if (!String(form.name || '').trim()) return 'Please enter your name.'
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return 'That email address does not look right.'
  }
  return ''
}
