/**
 * Postgres, over PostgREST.
 *
 * The read path for every keychain tap. Apps Script answers /exec with a 302 to
 * a single-use googleusercontent.com URL, so a profile cost 1.25-2.5s and could
 * not be cached — the redirect target 404s on replay. This is one request to
 * one index lookup, and the person holding the keychain sees their card without
 * a spinner.
 *
 * Deliberately not @supabase/supabase-js: every call here is an RPC, which the
 * SDK wraps without adding anything, and it is ~40KB gzipped of JavaScript in
 * front of the paint we are trying to make fast.
 *
 * Only functions are reachable. The table has RLS on with no policies, and anon
 * holds EXECUTE on a named list of SECURITY DEFINER functions — so the key
 * below can do exactly those nine things and nothing else. That is why it is
 * safe in a bundle; see db/schema.sql.
 */

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const DB_CONFIGURED = Boolean(URL_BASE && ANON_KEY)

const RPC = `${URL_BASE}/rest/v1/rpc`

/**
 * Raised when the database answered, and the answer was "no".
 *
 * Distinct from a transport failure on purpose: the caller falls back to the
 * Apps Script API when it cannot reach Postgres, but must NOT fall back when
 * Postgres has given a real verdict. Retrying "already claimed" against the
 * Sheet would be how one keychain ends up claimed twice.
 */
export class DbError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'DbError'
    this.code = code || 'ERROR'
    this.fromDatabase = true
  }
}

/** Thrown when the database could not be reached at all. Callers may fall back. */
export class DbUnreachable extends Error {
  constructor(message) {
    super(message)
    this.name = 'DbUnreachable'
  }
}

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
}

/**
 * Functions raise 'CODE|human sentence'. Postgres has no first-class way to
 * attach a machine code to an error that PostgREST will pass through, and the
 * app needs both halves: the code to decide what to render, the sentence to
 * show somebody standing at a conference desk.
 */
function toError(payload, status) {
  const raw = (payload && (payload.message || payload.error)) || ''
  const sep = raw.indexOf('|')

  if (sep > 0 && /^[A-Z_]+$/.test(raw.slice(0, sep))) {
    return new DbError(raw.slice(sep + 1), raw.slice(0, sep))
  }
  if (status === 401 || status === 403) {
    return new DbError('The database rejected this request. Check the anon key.', 'FORBIDDEN')
  }
  return new DbError(raw || `Request failed (${status})`, 'ERROR')
}

async function call(fn, args, { method = 'POST' } = {}) {
  if (!DB_CONFIGURED) throw new DbUnreachable('No database configured')

  let res
  try {
    if (method === 'GET') {
      const url = new URL(`${RPC}/${fn}`)
      Object.entries(args || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
      })
      res = await fetch(url.toString(), { headers })
    } else {
      res = await fetch(`${RPC}/${fn}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      })
    }
  } catch (err) {
    // DNS failure, offline, CORS, project paused. No verdict was given.
    throw new DbUnreachable(err.message || 'Could not reach the database')
  }

  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // An HTML error page from a proxy is an infrastructure problem, not an
    // answer about this keychain — so it is worth falling back over.
    throw new DbUnreachable('The database returned a non-JSON response')
  }

  if (!res.ok) {
    if (res.status >= 500) throw new DbUnreachable(`Database error ${res.status}`)
    throw toError(payload, res.status)
  }
  return payload
}

/* --------------------------------- public --------------------------------- */

/**
 * The hot path, and the reason any of this exists: a tap must feel instant.
 *
 * `apikey` and `Authorization` are not CORS-safelisted header names, so sending
 * them turns even a GET into a preflighted request — the browser spends a whole
 * round trip on OPTIONS before it asks the question. Measured here against
 * PostgREST: every read was preceded by its own OPTIONS.
 *
 * That preflight is cached afterwards, which sounds like it makes this moot. It
 * does not: somebody tapping a colleague's keychain is a FIRST request from
 * that phone, with nothing cached, which is exactly the case we are optimising.
 * Two round trips instead of one is the difference between ~80ms and ~160ms on
 * a mobile connection.
 *
 * Supabase's gateway also accepts the key as a query parameter, and a GET with
 * no custom headers is a simple request — no preflight. The key is public
 * either way; it is already in this bundle.
 *
 * Written as progressive enhancement rather than an assumption: if the gateway
 * does not accept it, the call falls back to the header form.
 *
 * The verdict is remembered per device, not per page load. A tap is usually the
 * only request that phone will make, so re-probing on every page load would
 * turn a wrong guess into an extra round trip on EVERY tap — a regression on
 * the exact number this change exists to improve. Remembered, a wrong guess
 * costs one request once per device.
 *
 * deploy/check-database.sh probes the real endpoint and reports which mode is
 * in effect, so this is a measured fact at deploy time rather than a hope.
 */
const PROBE_KEY = 'eqova.simpleRead'

function readProbe() {
  try {
    return localStorage.getItem(PROBE_KEY) !== 'no'
  } catch {
    return true // private mode: behave as if unprobed
  }
}

function rememberProbe(worked) {
  try {
    localStorage.setItem(PROBE_KEY, worked ? 'yes' : 'no')
  } catch {
    /* private mode — we simply re-probe next time */
  }
}

let simpleReadWorks = readProbe()

export async function getCard(slug) {
  if (simpleReadWorks) {
    try {
      const url = new URL(`${RPC}/get_card`)
      url.searchParams.set('p_slug', slug)
      url.searchParams.set('apikey', ANON_KEY)

      const res = await fetch(url.toString()) // no headers => no preflight
      if (res.ok) {
        rememberProbe(true)
        return JSON.parse(await res.text())
      }

      // A real verdict about this keychain, not a gateway complaint.
      if (res.status === 400) {
        throw toError(JSON.parse(await res.text()), res.status)
      }
      // Anything else means the gateway wanted the header form.
      simpleReadWorks = false
      rememberProbe(false)
    } catch (err) {
      if (err instanceof DbError) throw err
      simpleReadWorks = false
      rememberProbe(false)
    }
  }

  return call('get_card', { p_slug: slug }, { method: 'GET' })
}

export function claimCard(slug, doctor) {
  return call('claim_card', { p_slug: slug, p_card: doctor })
}

/* --------------------------------- staff ---------------------------------- */

export function stats() {
  return call('admin_stats', {}, { method: 'GET' })
}

export function list({ q = '', status = '', limit = 100, offset = 0 } = {}) {
  return call('admin_list', { p_q: q, p_status: status, p_limit: limit, p_offset: offset })
}

export function verifyPassword(password) {
  return call('verify_password', { p_password: password })
}

export function getRecord(id, password) {
  return call('admin_get', { p_id: Number(id), p_password: password })
}

export function updateRecord(id, doctor, password) {
  return call('admin_update', { p_id: Number(id), p_card: doctor, p_password: password })
}

export function setStatus(id, status, password) {
  return call('admin_set_status', { p_id: Number(id), p_status: status, p_password: password })
}

export function release(id, password) {
  return call('admin_release', { p_id: Number(id), p_password: password })
}
