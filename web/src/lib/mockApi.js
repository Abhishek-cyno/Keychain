/**
 * In-memory stand-in for the Apps Script API, used when VITE_API_BASE is unset
 * or set to "mock".
 *
 * It exists so the UI can be developed and demoed before the sheet is deployed,
 * and so the event workflow can be rehearsed on a laptop with no network. It
 * implements the same request shapes, the same error codes, and the same
 * public/private field split as `apps-script/Code.gs` — including the
 * duplicate-assignment refusal, which is worth being able to demonstrate.
 *
 * State lives in localStorage, so it survives a reload and nothing else.
 */

const STORE_KEY = 'eqova.mock.keychains'
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

/* --------------------------------- store ---------------------------------- */

function blank(id) {
  const now = new Date().toISOString()
  return {
    id,
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
    notes: 'Registered at booth 2',
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

function findRow(rows, rawId) {
  const id = parseInt(rawId, 10)
  return rows.find((r) => r.id === id) || null
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

function touch(row, patch, status) {
  Object.assign(row, patch, {
    status,
    assigned: Boolean(patch.name || row.name),
    updatedAt: new Date().toISOString(),
  })
  return row
}

/* --------------------------------- routes --------------------------------- */

export function mockGet(params, ApiError) {
  const rows = load()

  if (params.action === 'profile') {
    const row = findRow(rows, params.id)
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)

    const profile = { id: row.id, status: row.status, assigned: row.assigned && row.status !== 'BLOCKED' }
    if (profile.assigned) {
      PUBLIC_FIELDS.forEach((field) => {
        profile[field] = row[field]
      })
    }
    return respond(profile)
  }

  if (params.action === 'stats') {
    const stats = { total: rows.length, AVAILABLE: 0, ASSIGNED: 0, ACTIVE: 0, BLOCKED: 0 }
    rows.forEach((row) => {
      stats[row.status] = (stats[row.status] || 0) + 1
    })
    return respond(stats)
  }

  if (params.action === 'keychain') {
    const row = findRow(rows, params.id)
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    return respond({ ...row })
  }

  if (params.action === 'list') {
    const query = String(params.q || '').trim().toLowerCase()
    const status = String(params.status || '').toUpperCase()
    const limit = parseInt(params.limit, 10) || 50
    const offset = parseInt(params.offset, 10) || 0

    const matched = rows.filter((row) => {
      if (status && row.status !== status) return false
      if (!query) return true
      return [row.id, row.name, row.hospital, row.specialization, row.designation]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })

    return respond({ total: matched.length, items: matched.slice(offset, offset + limit) })
  }

  return reject('Unknown action', 'UNKNOWN_ACTION', ApiError)
}

export function mockPost(body, ApiError) {
  const rows = load()

  if (body.action === 'assign') {
    const row = findRow(rows, body.id)
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    if (row.status !== (body.expectedStatus || 'AVAILABLE') || row.name) {
      return reject(`Keychain ${row.id} is ${row.status}.`, 'CONFLICT', ApiError)
    }
    touch(row, normalize(body.doctor), 'ACTIVE')
    save(rows)
    return respond({ ...row })
  }

  if (body.action === 'update') {
    const row = findRow(rows, body.id)
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    touch(row, normalize(body.doctor), row.status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE')
    save(rows)
    return respond({ ...row })
  }

  if (body.action === 'setStatus') {
    const row = findRow(rows, body.id)
    if (!row) return reject('No keychain with that ID', 'NOT_FOUND', ApiError)
    row.status = String(body.status).toUpperCase()
    row.updatedAt = new Date().toISOString()
    save(rows)
    return respond({ id: row.id, status: row.status })
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
  PUBLIC_FIELDS.concat('notes').forEach((field) => {
    const value = input[field]
    out[field] = field === 'links' ? (Array.isArray(value) ? value : []) : String(value || '').trim()
  })
  return out
}
