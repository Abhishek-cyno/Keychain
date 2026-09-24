/**
 * In-browser stand-in for the Apps Script API, used when VITE_API_BASE is unset
 * or set to "mock".
 *
 * It mirrors the real contract — slug addressing, the self-service claim, the
 * password gate on staff writes, and the same error codes — so the whole flow
 * can be rehearsed on a laptop before the sheet exists.
 *
 * State lives in localStorage, so it survives a reload and nothing else.
 */

const STORE_KEY = 'eqova.mock.keychains.v2'
const MOCK_PASSWORD = 'demo'
const SEED_COUNT = 24
const LATENCY_MS = 180

const PUBLIC_FIELDS = [
  'name',
  'specialization',
  'hospital',
  'designation',
  'phone',
  'email',
  'bio',
  'linkedin',
  'website',
  'links',
]

const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

function makeSlug() {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join('')
}

/* --------------------------------- store ---------------------------------- */

function blank(id) {
  const now = new Date().toISOString()
  return {
    id,
    slug: makeSlug(),
    status: 'AVAILABLE',
    assigned: false,
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
    createdAt: now,
    updatedAt: now,
  }
}

function seed() {
  const rows = Array.from({ length: SEED_COUNT }, (_, i) => blank(i + 1))

  Object.assign(rows[0], {
    status: 'ACTIVE',
    assigned: true,
    name: 'Dr. Amit Sharma',
    specialization: 'Cardiologist',
    hospital: 'ABC Hospital',
    designation: 'Senior Consultant',
    phone: '+91 98765 43210',
    email: 'amit.sharma@example.com',
    bio: 'Interventional cardiologist with 18 years of experience in complex coronary work. Special interest in preventive cardiology and post-operative care.',
    linkedin: 'linkedin.com/in/example',
    website: 'abchospital.example.com',
    notes: 'Claimed at the Mumbai event',
  })

  Object.assign(rows[1], {
    status: 'ACTIVE',
    assigned: true,
    name: 'Dr. Rahul Verma',
    specialization: 'Neurologist',
    hospital: 'XYZ Hospital',
    designation: 'Consultant',
    phone: '+91 91234 56780',
    email: 'rahul.verma@example.com',
    bio: 'Focused on epilepsy and movement disorders.',
  })

  Object.assign(rows[3], { status: 'BLOCKED', notes: 'Keychain damaged in transit' })

  return rows
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* fall through to a fresh seed */
  }
  const rows = seed()
  save(rows)
  return rows
}

function save(rows) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rows))
  } catch {
    /* private mode — the demo simply resets on reload */
  }
}

/** Exposed so the demo banner can show a slug that actually exists. */
export function mockSampleSlugs() {
  const rows = load()
  return {
    claimed: rows.find((r) => r.assigned && r.status === 'ACTIVE')?.slug || '',
    claimable: rows.find((r) => !r.assigned && r.status === 'AVAILABLE')?.slug || '',
    blocked: rows.find((r) => r.status === 'BLOCKED')?.slug || '',
  }
}

/* -------------------------------- plumbing -------------------------------- */

function respond(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS))
}

function reject(message, code, ApiError) {
  return new Promise((_, rejectPromise) =>
    setTimeout(() => rejectPromise(new ApiError(message, code)), LATENCY_MS)
  )
}

function requirePassword(password, ApiError) {
  if (String(password || '') !== MOCK_PASSWORD) {
    return reject(`Incorrect password. The demo password is "${MOCK_PASSWORD}".`, 'UNAUTHORISED', ApiError)
  }
  return null
}

function publicView(row) {
  const status = row.status
  const claimed = Boolean(row.name) && status !== 'AVAILABLE'
  const profile = {
    slug: row.slug,
    number: row.id,
    status,
    assigned: claimed && status !== 'BLOCKED',
    claimable: status === 'AVAILABLE' && !row.name,
  }
  if (profile.assigned) {
    PUBLIC_FIELDS.forEach((f) => {
      profile[f] = row[f]
    })
  }
  return profile
}

function adminView(row) {
  return { ...row }
}

function listView(row) {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    assigned: Boolean(row.name),
    name: row.name,
    specialization: row.specialization,
    hospital: row.hospital,
    updatedAt: row.updatedAt,
  }
}

/* --------------------------------- routes --------------------------------- */

export function mockGet(params, ApiError) {
  const rows = load()

  if (params.action === 'profile') {
    const slug = String(params.slug || '').toLowerCase()
    const row = rows.find((r) => r.slug === slug)
    if (!row) return reject('No keychain with that code', 'NOT_FOUND', ApiError)
    return respond(publicView(row))
  }

  if (params.action === 'stats') {
    const stats = { total: rows.length, AVAILABLE: 0, ASSIGNED: 0, ACTIVE: 0, BLOCKED: 0 }
    rows.forEach((row) => {
      stats[row.status] = (stats[row.status] || 0) + 1
    })
    return respond(stats)
  }

  if (params.action === 'list') {
    const query = String(params.q || '').trim().toLowerCase()
    const status = String(params.status || '').toUpperCase()
    const limit = parseInt(params.limit, 10) || 50
    const offset = parseInt(params.offset, 10) || 0

    const matched = rows.filter((row) => {
      if (status && row.status !== status) return false
      if (!query) return true
      return [row.id, row.slug, row.name, row.hospital, row.specialization]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })

    return respond({
      total: matched.length,
      items: matched.slice(offset, offset + limit).map(listView),
    })
  }

  // Everything below needs the password.
  const denied = requirePassword(params.password, ApiError)
  if (denied) return denied

  if (params.action === 'verifyPassword') return respond({ ok: true })

  if (params.action === 'keychain') {
    const row = rows.find((r) => r.id === parseInt(params.id, 10))
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    return respond(adminView(row))
  }

  return reject('Unknown action', 'UNKNOWN_ACTION', ApiError)
}

export function mockPost(body, ApiError) {
  const rows = load()

  // Public, on purpose: holding the keychain is the authority.
  if (body.action === 'claim') {
    const slug = String(body.slug || '').toLowerCase()
    const row = rows.find((r) => r.slug === slug)
    if (!row) return reject('No keychain with that code', 'NOT_FOUND', ApiError)
    if (row.status === 'BLOCKED') {
      return reject('This keychain is not available.', 'BLOCKED', ApiError)
    }
    if (row.name || row.status !== 'AVAILABLE') {
      return reject(
        'This keychain has already been set up. Ask the Eqova team if you need it changed.',
        'ALREADY_CLAIMED',
        ApiError
      )
    }
    if (!String(body.doctor?.name || '').trim()) {
      return reject('Please enter your name.', 'NAME_REQUIRED', ApiError)
    }

    Object.assign(row, normalize(body.doctor), {
      status: 'ACTIVE',
      assigned: true,
      updatedAt: new Date().toISOString(),
    })
    save(rows)
    return respond(publicView(row))
  }

  const denied = requirePassword(body.password, ApiError)
  if (denied) return denied

  if (body.action === 'update') {
    const row = rows.find((r) => r.id === parseInt(body.id, 10))
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    Object.assign(row, normalize(body.doctor), {
      status: row.status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE',
      assigned: Boolean(body.doctor?.name),
      notes: String(body.doctor?.notes || '').trim(),
      updatedAt: new Date().toISOString(),
    })
    save(rows)
    return respond(adminView(row))
  }

  if (body.action === 'setStatus') {
    const row = rows.find((r) => r.id === parseInt(body.id, 10))
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    row.status = String(body.status).toUpperCase()
    row.updatedAt = new Date().toISOString()
    save(rows)
    return respond({ id: row.id, status: row.status })
  }

  if (body.action === 'release') {
    const row = rows.find((r) => r.id === parseInt(body.id, 10))
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    Object.assign(row, blank(row.id), { createdAt: row.createdAt })
    save(rows)
    return respond({ id: row.id, status: 'AVAILABLE', slug: row.slug })
  }

  if (body.action === 'seed') {
    const count = parseInt(body.count, 10) || 0
    let created = 0
    for (let id = 1; id <= count; id++) {
      if (!rows.some((r) => r.id === id)) {
        rows.push(blank(id))
        created++
      }
    }
    rows.sort((a, b) => a.id - b.id)
    save(rows)
    return respond({ created, total: rows.length })
  }

  return reject('Unknown action', 'UNKNOWN_ACTION', ApiError)
}

function normalize(doctor) {
  const input = doctor || {}
  const out = {}
  PUBLIC_FIELDS.forEach((field) => {
    const value = input[field]
    out[field] = field === 'links' ? (Array.isArray(value) ? value : []) : String(value || '').trim()
  })
  return out
}

export const MOCK_PASSWORD_HINT = MOCK_PASSWORD
