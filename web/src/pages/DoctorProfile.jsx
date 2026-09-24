import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchProfile } from '../lib/api.js'
import Spinner from '../components/Spinner.jsx'
import { Shell, Notice } from '../components/ProfileShell.jsx'
import ClaimCard from './ClaimCard.jsx'

/**
 * What a tapped keychain resolves to. Exactly one of:
 *   - a card, if someone has already set this keychain up
 *   - a form, if it is still unclaimed and whoever is holding it can claim it
 *   - a notice, if it is blocked or the code is unknown
 *
 * The slug in the URL is the only key. There is no numeric lookup, by design:
 * if /d/1 worked, the random code on the keychain would buy nothing.
 */
export default function DoctorProfile() {
  const { slug } = useParams()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    // Cheap client-side shape check, so an obviously wrong link does not cost
    // a round trip. The server validates properly regardless.
    if (!/^[a-z0-9]{4,32}$/i.test(String(slug || ''))) {
      setState({ status: 'error', code: 'NOT_FOUND' })
      return
    }

    fetchProfile(String(slug).toLowerCase()).then(
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
  const links = buildLinks(doctor)

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-xl shadow-brand-900/15">
      <div className="h-24 bg-gradient-to-r from-brand-600 to-brand-500" />

      <div className="-mt-14 px-6 pb-6 text-center">
        <Avatar name={doctor.name} />

        <h1 className="mt-4 text-[22px] font-bold leading-tight text-slate-900">{doctor.name}</h1>

        {doctor.specialization && (
          <p className="mt-1 text-[15px] font-semibold text-brand-600">{doctor.specialization}</p>
        )}

        {(doctor.hospital || doctor.designation) && (
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            {doctor.designation && <span>{doctor.designation}</span>}
            {doctor.designation && doctor.hospital && <span className="px-1.5 text-slate-300">·</span>}
            {doctor.hospital && <span>{doctor.hospital}</span>}
          </p>
        )}
      </div>

      {doctor.bio && (
        <section className="border-t border-slate-100 px-6 py-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">About</h2>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-600">{doctor.bio}</p>
        </section>
      )}

      {links.length > 0 && (
        <section className="space-y-2.5 border-t border-slate-100 px-6 py-5">
          {links.map((link) => (
            <ActionLink key={link.label + link.href} {...link} />
          ))}
        </section>
      )}

      <section className="border-t border-slate-100 px-6 py-5">
        <SaveContactButton doctor={doctor} />
      </section>

      <footer className="bg-slate-50 px-6 py-4 text-center">
        <p className="text-xs text-slate-400">
          Powered by <span className="font-semibold text-slate-500">Eqova</span>
        </p>
      </footer>
    </article>
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
    <div className="mx-auto grid h-28 w-28 place-items-center rounded-full border-4 border-white bg-brand-100 text-3xl font-bold text-brand-700 shadow-md">
      {initials || '?'}
    </div>
  )
}

function ActionLink({ href, label, value, icon, external }) {
  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}

  return (
    <a
      href={href}
      {...externalProps}
      className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 transition hover:border-brand-300 hover:bg-brand-50 active:scale-[0.99]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-xs font-medium text-slate-400">{label}</span>
        <span className="block truncate text-[15px] font-semibold text-slate-800">{value}</span>
      </span>
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
    </a>
  )
}

function SaveContactButton({ doctor }) {
  function save() {
    const title = [doctor.designation, doctor.specialization].filter(Boolean).join(', ')
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${doctor.name || ''};;;;`,
      `FN:${doctor.name || ''}`,
      doctor.hospital ? `ORG:${doctor.hospital}` : '',
      title ? `TITLE:${title}` : '',
      doctor.phone ? `TEL;TYPE=CELL:${doctor.phone}` : '',
      doctor.email ? `EMAIL;TYPE=WORK:${doctor.email}` : '',
      doctor.website ? `URL:${doctor.website}` : '',
      `NOTE:Eqova profile ${window.location.href}`,
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
    <button type="button" onClick={save} className="btn-primary w-full !py-3">
      <svg
        className="h-4 w-4"
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
      Save contact
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
  linkedin: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M6.94 8.5H4.06V20h2.88V8.5ZM5.5 4a1.68 1.68 0 1 0 0 3.36A1.68 1.68 0 0 0 5.5 4ZM20 13.9c0-3.1-1.66-4.55-3.87-4.55a3.34 3.34 0 0 0-3.03 1.67V8.5H10.2V20h2.9v-6.09c0-1.6.3-3.16 2.29-3.16s1.71 1.83 1.71 3.26V20H20v-6.1Z" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 13a4 4 0 0 0 5.66 0l2.5-2.5a4 4 0 0 0-5.66-5.66L11 6.34" strokeLinecap="round" />
      <path d="M14 11a4 4 0 0 0-5.66 0l-2.5 2.5a4 4 0 1 0 5.66 5.66L13 17.66" strokeLinecap="round" />
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

function buildLinks(doctor) {
  const links = []

  if (doctor.phone) {
    links.push({
      label: 'Call',
      value: doctor.phone,
      href: `tel:${String(doctor.phone).replace(/[^\d+]/g, '')}`,
      icon: icons.phone,
    })
  }

  if (doctor.email) {
    links.push({
      label: 'Email',
      value: doctor.email,
      href: `mailto:${doctor.email}`,
      icon: icons.mail,
    })
  }

  if (doctor.website) {
    const href = normalizeUrl(doctor.website)
    links.push({ label: 'Website', value: prettyUrl(href), href, icon: icons.globe, external: true })
  }

  if (doctor.linkedin) {
    const href = normalizeUrl(doctor.linkedin)
    links.push({ label: 'LinkedIn', value: 'View profile', href, icon: icons.linkedin, external: true })
  }

  const extra = Array.isArray(doctor.links) ? doctor.links : []
  extra.forEach((entry) => {
    if (!entry || !entry.url) return
    const href = normalizeUrl(entry.url)
    links.push({ label: entry.label || 'Link', value: prettyUrl(href), href, icon: icons.link, external: true })
  })

  return links
}
