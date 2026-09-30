import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchProfile, RESERVED_PATHS } from '../lib/api.js'
import Spinner from '../components/Spinner.jsx'
import { Shell, Notice } from '../components/ProfileShell.jsx'
import BrandFooter from '../components/BrandFooter.jsx'
import ClaimCard from './ClaimCard.jsx'

/**
 * What a tapped keychain resolves to. Exactly one of:
 *   - a card, if someone has already set this keychain up
 *   - a form, if it is still unclaimed and whoever is holding it can claim it
 *   - a notice, if it is blocked or the code is unknown
 *
 * The code in the URL is the only key — tap.eqova.in/<code>. There is no
 * numeric lookup, by design: if the keychain's number resolved, the random
 * code would buy nothing.
 */
export default function DoctorProfile() {
  const { slug } = useParams()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    // Cheap client-side shape check, so an obviously wrong link does not cost
    // a round trip. The server validates properly regardless.
    //
    // Codes now sit at the domain root, so a path the app owns could be
    // mistaken for one. Router ranking already prevents that; this makes it
    // true even if the routes are rearranged later.
    const candidate = String(slug || '').toLowerCase()
    if (!/^[a-z0-9]{4,32}$/.test(candidate) || RESERVED_PATHS.includes(candidate)) {
      setState({ status: 'error', code: 'NOT_FOUND' })
      return
    }

    fetchProfile(candidate).then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (err) => !cancelled && setState({ status: 'error', code: err.code, message: err.message })
    )

    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    const doctor = state.status === 'ready' ? state.data : null
    document.title = doctor && doctor.name ? `${doctor.name} · Eqova` : 'Eqova'
  }, [state])

  if (state.status === 'loading') {
    return (
      <Shell>
        <Spinner label="Loading" />
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <Notice
          title={state.code === 'NOT_FOUND' ? 'Keychain not recognised' : 'Something went wrong'}
          body={
            state.code === 'NOT_FOUND'
              ? 'This link does not match any Eqova keychain. Check the code printed on yours.'
              : state.message || 'Please try again in a moment.'
          }
        />
      </Shell>
    )
  }

  const doctor = state.data

  if (doctor.status === 'BLOCKED') {
    return (
      <Shell>
        <Notice
          title="This profile is currently unavailable."
          body="Please contact the Eqova team for assistance."
        />
      </Shell>
    )
  }

  // Unclaimed: whoever is holding this keychain sets it up themselves.
  if (doctor.claimable) {
    return (
      <ClaimCard
        slug={doctor.slug}
        number={doctor.number}
        onClaimed={(profile) => setState({ status: 'ready', data: profile })}
      />
    )
  }

  if (!doctor.assigned) {
    return (
      <Shell>
        <Notice
          title="This keychain is not active yet"
          body="Please contact the Eqova team for assistance."
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <ProfileCard doctor={doctor} />
    </Shell>
  )
}

function ProfileCard({ doctor }) {
  const quick = buildQuickActions(doctor)
  const details = buildDetails(doctor)

  return (
    <article className="profile-card flex flex-1 flex-col overflow-hidden rounded-b-[28px] rounded-t-none bg-white shadow-xl shadow-brand-900/20 sm:rounded-[28px]">
      <CoverWave />

      {/* relative, or the wave above paints over this: a positioned element
          outranks a later static sibling in CSS painting order, whatever the
          DOM order says. */}
      <div className="pc-head relative -mt-[58px] px-6 text-center">
        <Avatar name={doctor.name} />

        <h1 className="pc-name mt-3 text-[23px] font-bold leading-tight tracking-tight text-slate-900">
          {[doctor.title, doctor.name].filter(Boolean).join(' ')}
        </h1>

        {doctor.designation && (
          <p className="mt-1 text-[15px] font-bold leading-snug text-brand-600">
            {doctor.designation}
          </p>
        )}

        {doctor.organization && (
          <p className="mt-1 text-[14px] leading-snug text-slate-500">{doctor.organization}</p>
        )}
      </div>

      {quick.length > 0 && (
        <div
          className="pc-quick grid gap-2.5 px-5 pt-4"
          style={{ gridTemplateColumns: `repeat(${quick.length}, minmax(0, 1fr))` }}
        >
          {quick.map((action) => (
            <QuickAction key={action.label} {...action} />
          ))}
        </div>
      )}

      {details.length > 0 && (
        <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {details.map((row) => (
            <DetailRow key={row.label + row.value} {...row} />
          ))}
        </div>
      )}

      <div className="flex-1" />

      <div className="pc-save px-5 py-4">
        <SaveContactButton doctor={doctor} />
      </div>

      <BrandFooter className="border-t border-slate-100 bg-slate-50" />
    </article>
  )
}

/**
 * The header.
 *
 * Two curves, not one: a pale wedge that widens left to right, and the white
 * body rising underneath it. A single arc reads as a stray rounded corner at
 * phone width — the second layer is what makes it look intended.
 *
 * preserveAspectRatio="none" lets the curves stretch to any width without
 * changing their height, so the avatar overlaps by the same amount on every
 * screen.
 */
function CoverWave() {
  return (
    <div className="pc-cover relative h-[118px] bg-gradient-to-br from-brand-500 via-brand-500 to-brand-600">
      <svg
        className="pc-wave absolute inset-x-0 bottom-0 h-[72px] w-full"
        viewBox="0 0 400 80"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 42 C 80 26, 150 41, 230 31 C 300 22, 356 12, 400 5 L400 80 L0 80 Z"
          fill="#ffffff"
          fillOpacity="0.17"
        />
        <path
          d="M0 50 C 80 63, 170 52, 250 58 C 320 63, 362 66, 400 69 L400 80 L0 80 Z"
          fill="#ffffff"
        />
      </svg>
    </div>
  )
}

function Avatar({ name }) {
  const initials = String(name || '')
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <div className="pc-avatar mx-auto grid h-[92px] w-[92px] place-items-center rounded-full border-4 border-white bg-brand-50 text-[30px] font-bold tracking-wide text-brand-700 shadow-lg shadow-brand-900/10">
      {initials || '?'}
    </div>
  )
}

/** Call / WhatsApp / Email — the three things somebody does straight after a tap. */
function QuickAction({ href, label, icon, tint, external }) {
  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}

  return (
    <a
      href={href}
      {...externalProps}
      className="pc-tile flex flex-col items-center gap-1.5 rounded-2xl bg-slate-50 px-1 py-3 transition hover:bg-slate-100 active:scale-[0.97]"
    >
      <span className={tint}>{icon}</span>
      <span className="text-[14px] font-semibold text-slate-700">{label}</span>
    </a>
  )
}

function DetailRow({ href, label, value, icon, external, multiline }) {
  const body = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[12px] leading-tight text-slate-400">{label}</span>
        <span
          className={`block break-words text-[15px] font-semibold leading-snug text-slate-800 ${
            multiline ? 'whitespace-pre-line' : ''
          }`}
        >
          {value}
        </span>
      </span>
      {href && (
        <svg
          className="h-4 w-4 shrink-0 text-slate-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  )

  // An address is not a link, so it must not look tappable or animate on press.
  if (!href) {
    return <div className="pc-row flex items-center gap-3.5 px-5 py-2.5">{body}</div>
  }

  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  return (
    <a
      href={href}
      {...externalProps}
      className="pc-row flex items-center gap-3.5 px-5 py-2.5 transition hover:bg-slate-50 active:bg-slate-100"
    >
      {body}
    </a>
  )
}

function SaveContactButton({ doctor }) {
  function save() {
    // vCard reserves ';' and ',' as field separators, so anything the holder
    // typed has to be escaped or the card splits at their punctuation.
    const esc = (value) => String(value || '').replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n')
    const full = [doctor.title, doctor.name].filter(Boolean).join(' ')

    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${esc(doctor.name)};;;${esc(doctor.title)};`,
      `FN:${esc(full)}`,
      doctor.organization ? `ORG:${esc(doctor.organization)}` : '',
      doctor.designation ? `TITLE:${esc(doctor.designation)}` : '',
      doctor.mobile ? `TEL;TYPE=CELL:${esc(doctor.mobile)}` : '',
      doctor.phone ? `TEL;TYPE=WORK:${esc(doctor.phone)}` : '',
      doctor.email ? `EMAIL;TYPE=WORK:${esc(doctor.email)}` : '',
      doctor.website ? `URL:${esc(doctor.website)}` : '',
      doctor.address ? `ADR;TYPE=WORK:;;${esc(doctor.address)};;;;` : '',
      `NOTE:${doctor.remarks ? esc(doctor.remarks) + '\\n' : ''}Eqova profile ${window.location.href}`,
      'END:VCARD',
    ]
      .filter(Boolean)
      .join('\r\n')

    const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(doctor.name || 'contact').replace(/[^\w]+/g, '_')}.vcf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <button
      type="button"
      onClick={save}
      className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-brand-600 px-4 py-3.5 text-[16px] font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 active:scale-[0.99]"
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path
          d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Save Contact
    </button>
  )
}

/* -------------------------------------------------------------------------- */

const icons = {
  phone: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        d="M5 4h3.5l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5V18a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3 6.2 2 2 0 0 1 5 4Z"
        strokeLinejoin="round"
      />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" strokeLinecap="round" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
    </svg>
  ),
  mobile: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" strokeLinecap="round" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  note: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
    </svg>
  ),
}

/* Larger, filled glyphs for the three quick actions — at this size an outline
   icon looks thin next to the solid WhatsApp mark. */
const quickIcons = {
  call: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2Z" />
    </svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2.05 22l5.3-1.38a9.86 9.86 0 0 0 4.69 1.19h.004c5.45 0 9.9-4.44 9.9-9.9 0-2.64-1.03-5.13-2.9-7a9.82 9.82 0 0 0-7-2.9Zm0 18.13h-.003a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.1.81.83-3.03-.2-.31a8.17 8.17 0 0 1-1.25-4.37c0-4.53 3.69-8.22 8.22-8.22 2.2 0 4.26.86 5.81 2.42a8.17 8.17 0 0 1 2.41 5.81c0 4.53-3.69 8.22-8.22 8.22Zm4.5-6.16c-.24-.12-1.46-.72-1.69-.8-.22-.09-.39-.13-.55.12-.17.25-.64.8-.78.97-.15.16-.29.19-.53.06-.25-.12-1.04-.38-1.99-1.22-.73-.66-1.23-1.46-1.37-1.71-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.13-.55-1.34-.76-1.83-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.66.31-.22.25-.86.84-.86 2.06s.89 2.39 1.01 2.56c.12.16 1.74 2.66 4.22 3.73.59.25 1.05.4 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.46-.6 1.67-1.18.2-.57.2-1.07.14-1.17-.06-.11-.22-.17-.46-.29Z" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v.35l-10 5.9-10-5.9V6a2 2 0 0 1 2-2Zm18 4.67V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.67l9.49 5.6a1 1 0 0 0 1.02 0L22 8.67Z" />
    </svg>
  ),
}

function normalizeUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function prettyUrl(href) {
  return href.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

const dial = (value) => `tel:${String(value).replace(/[^\d+]/g, '')}`

/**
 * The three shortcuts across the top of the card.
 *
 * Each only appears when there is something behind it, and the row divides
 * evenly however many there are — a card with no email shows two wide buttons
 * rather than two and a gap.
 */
function buildQuickActions(doctor) {
  const actions = []
  const callable = doctor.mobile || doctor.phone

  if (callable) {
    actions.push({
      label: 'Call',
      href: dial(callable),
      icon: quickIcons.call,
      tint: 'text-brand-600',
    })
  }

  if (doctor.mobile) {
    // wa.me wants digits only, no punctuation and no leading +. A number
    // stored without a country code cannot be dialled internationally, so it
    // is left out rather than opening WhatsApp on a number that will not
    // resolve.
    const digits = String(doctor.mobile).replace(/\D/g, '')
    if (digits.length >= 10) {
      actions.push({
        label: 'WhatsApp',
        href: `https://wa.me/${digits}`,
        icon: quickIcons.whatsapp,
        tint: 'text-[#25D366]',
        external: true,
      })
    }
  }

  if (doctor.email) {
    actions.push({
      label: 'Email',
      href: `mailto:${doctor.email}`,
      icon: quickIcons.mail,
      tint: 'text-brand-600',
    })
  }

  return actions
}

/** The detail list below the shortcuts, in the order the card shows it. */
function buildDetails(doctor) {
  const rows = []

  if (doctor.address) {
    rows.push({ label: 'Address', value: doctor.address, icon: icons.pin, multiline: true })
  }

  if (doctor.mobile) {
    rows.push({ label: 'Mobile', value: doctor.mobile, href: dial(doctor.mobile), icon: icons.mobile })
  }

  if (doctor.phone) {
    rows.push({ label: 'Phone', value: doctor.phone, href: dial(doctor.phone), icon: icons.phone })
  }

  if (doctor.email) {
    rows.push({ label: 'Email', value: doctor.email, href: `mailto:${doctor.email}`, icon: icons.mail })
  }

  if (doctor.website) {
    const href = normalizeUrl(doctor.website)
    rows.push({ label: 'Website', value: prettyUrl(href), href, icon: icons.globe, external: true })
  }

  if (doctor.remarks) {
    rows.push({ label: 'Remarks', value: doctor.remarks, icon: icons.note, multiline: true })
  }

  return rows
}
