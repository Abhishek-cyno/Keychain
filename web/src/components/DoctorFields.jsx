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

const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+65', '+971', '+966', '+974', '+977', '+880', '+94']
const DEFAULT_CODE = '+91'

/**
 * Mobile is stored as one string ("+91 9876543210") so the sheet and the card
 * are unchanged; here it is split into a country code and a 10-digit number.
 */
export function splitMobile(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\+\d{1,4})\s*(.*)$/)
  const code = match ? match[1] : DEFAULT_CODE
  const number = (match ? match[2] : raw).replace(/\D/g, '').slice(0, 10)
  return { code, number }
}

function MobileInput({ value, onChange }) {
  const { code, number } = splitMobile(value)
  const codes = COUNTRY_CODES.includes(code) ? COUNTRY_CODES : [code, ...COUNTRY_CODES]
  const join = (c, n) => `${c} ${n}`

  return (
    <div className="flex gap-2">
      <select
        className="input !w-auto shrink-0"
        value={code}
        onChange={(e) => onChange(join(e.target.value, number))}
        aria-label="Country code"
        autoComplete="tel-country-code"
      >
        {codes.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        className="input min-w-0 flex-1"
        type="tel"
        inputMode="numeric"
        maxLength={10}
        value={number}
        onChange={(e) => onChange(join(code, e.target.value.replace(/\D/g, '').slice(0, 10)))}
        placeholder="9876543210"
        autoComplete="tel-national"
      />
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

        <Field label="Mobile">
          <MobileInput value={form.mobile} onChange={(value) => onChange('mobile', value)} />
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
  // A country code on its own is not a number worth showing.
  if (!splitMobile(out.mobile).number) out.mobile = ''
  return out
}

export function validateDoctor(form) {
  if (!String(form.name || '').trim()) return 'Please enter your name.'
  const mobile = splitMobile(form.mobile).number
  if (mobile && mobile.length !== 10) return 'Mobile number must be 10 digits.'
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return 'That email address does not look right.'
  }
  return ''
}
