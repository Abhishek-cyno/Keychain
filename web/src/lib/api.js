/**
 * Thin client for the data layer.
 *
 * Everything the app knows about storage lives behind this module. There are
 * two backends, and the split is deliberate and narrow:
 *
 *   Postgres   resolving a tapped keychain. Read only. ~50ms.
 *   Apps Script + Google Sheet   everything else, and every write.
 *
 * WHY THE SPLIT IS THIS SHAPE
 * 500 keychains are already in people's hands and 97 doctors have set up their
 * cards. The sheet is the record of that, and nothing is worth risking it for.
 * So writes go where they have always gone — through Apps Script, into the
 * sheet — and Postgres is a mirror of the sheet that exists for one reason:
 * a tap used to take 1.25-2.5s, because /exec answers with a 302 to a
 * single-use googleusercontent.com URL that cannot be cached. That is the
 * request a person stands there waiting for.
 *
 * Nothing writes to Postgres from here. apps-script/Sync.gs copies the sheet
 * into it, one way, and Code.gs mirrors each row the moment it is written so a
 * doctor who has just claimed a keychain sees their card and not the form.
 *
 * FALLBACK
 * If Postgres cannot be reached, a tap falls through to Apps Script — slower,
 * but a keychain somebody is physically holding still works. The distinction
 * that makes this safe is in db.js: a DbError is a real verdict ("no keychain
 * with that code") and is never retried elsewhere; only DbUnreachable, where no
 * verdict was given, falls back.
 *
 * Keychains are addressed by an unguessable slug, never by their sequential
 * number. The number exists for the ops team and is printed on the physical
 * object; it is deliberately not a way to reach a profile.
 */

import * as db from './db.js'

const API_BASE = import.meta.env.VITE_API_BASE || ''

export const DB_CONFIGURED = db.DB_CONFIGURED

/**
 * With neither backend configured the app falls back to an in-browser mock, so
 * a fresh clone runs and the claim flow can be rehearsed offline.
 */
export const USING_MOCK =
  !db.DB_CONFIGURED && (!API_BASE || API_BASE === 'mock' || API_BASE.includes('XXXXXXXX'))

const SHEET_CONFIGURED = Boolean(API_BASE) && API_BASE !== 'mock' && !API_BASE.includes('XXXXXXXX')

export const PUBLIC_ORIGIN = (
  import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin
).replace(/\/$/, '')

/**
 * Paths the app owns, which therefore can never be a keychain code. The code
 * generator excludes them too, so one can never be minted.
 */
export const RESERVED_PATHS = ['admin', 'assets', 'api', 'static', 'index.html']

export function profileUrl(slug) {
  return `${PUBLIC_ORIGIN}/${slug}`
}

export class ApiError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ApiError'
    this.code = code || 'ERROR'
  }
}

/* ------------------------------ apps script ------------------------------- */

async function unwrap(res) {
  let payload
  const text = await res.text()
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ApiError('The API returned a non-JSON response. Check the Apps Script deployment.', 'BAD_RESPONSE')
  }
  if (!payload.ok) {
    throw new ApiError(payload.error || 'Request failed', payload.code || 'ERROR')
  }
  return payload.data
}

async function get(params) {
  if (USING_MOCK) {
    const { mockGet } = await import('./mockApi.js')
    return mockGet(params, ApiError)
  }

  const url = new URL(API_BASE)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
  })
  // Apps Script's /exec redirect (302 → a one-time googleusercontent.com URL) has no
  // Cache-Control header, so the browser happily caches and replays it on the next
  // identical GET — and that URL is single-use, so the replay 404s.
  url.searchParams.set('_', Date.now())
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow', cache: 'no-store' })
  return unwrap(res)
}

async function post(body) {
  if (USING_MOCK) {
    const { mockPost } = await import('./mockApi.js')
    return mockPost(body, ApiError)
  }

  // text/plain keeps this a CORS "simple request" — Apps Script web apps do not
  // answer OPTIONS preflights, so application/json would fail in the browser.
  const res = await fetch(API_BASE, {
    method: 'POST',
    redirect: 'follow',
    cache: 'no-store',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  })
  return unwrap(res)
}

/* ------------------------------ staff password ---------------------------- */

const PASSWORD_KEY = 'eqova.adminPassword'

export function getPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) || ''
  } catch {
    return ''
  }
}

export function setPassword(value) {
  try {
    if (value) sessionStorage.setItem(PASSWORD_KEY, value)
    else sessionStorage.removeItem(PASSWORD_KEY)
  } catch {
    /* private mode — the password simply will not persist across reloads */
  }
}

export function clearPassword() {
  setPassword('')
}

export function verifyPassword(password) {
  return get({ action: 'verifyPassword', password })
}

/* --------------------------------- public --------------------------------- */

/**
 * Resolve a tapped keychain. The result is one of three things: a card to
 * show, an invitation to claim, or a blocked/unknown notice.
 *
 * The one call that has to be instant — it is what a tap runs, and the only
 * thing this app reads from Postgres.
 */
export function fetchProfile(slug) {
  if (db.DB_CONFIGURED) {
    return db.getCard(slug).catch((err) => {
      if (err instanceof db.DbError) throw new ApiError(err.message, err.code)
      // No verdict was given, so it is safe to ask the sheet.
      console.warn('[eqova] database unreachable, falling back to the sheet:', err.message)
      return get({ action: 'profile', slug })
    })
  }
  return get({ action: 'profile', slug })
}

/**
 * Self-service claim. No password — holding the keychain is the authority.
 *
 * Goes to the sheet, not to Postgres. This is the path that has worked for
 * every doctor carrying one of these keychains, and the sheet is where the
 * record belongs; Code.gs mirrors the row into Postgres in the same request so
 * the very next tap resolves from the fast path.
 */
export function claimKeychain(slug, doctor) {
  return post({ action: 'claim', slug, doctor })
}

/* ------------------------------- staff only -------------------------------- */
/*
 * All of this stays on Apps Script. It is a handful of requests a day by people
 * sitting at a desk, so the latency does not matter — and keeping every write
 * on one path means one source of truth and one staff password, rather than two
 * of each drifting apart.
 */

export function fetchStats() {
  return get({ action: 'stats' })
}

/** Dashboard rows. Contact details are deliberately not included. */
export function fetchKeychains({ q = '', status = '', limit = 100, offset = 0 } = {}) {
  return get({ action: 'list', q, status, limit, offset })
}

/** Full record, contact details included. Password required. */
export function fetchKeychain(id) {
  return get({ action: 'keychain', id, password: getPassword() })
}

export function updateKeychain(id, doctor) {
  return post({ action: 'update', id, doctor, password: getPassword() })
}

export function setKeychainStatus(id, status) {
  return post({ action: 'setStatus', id, status, password: getPassword() })
}

/** Clear a card and issue a new slug, retiring the printed code. */
export function releaseKeychain(id) {
  return post({ action: 'release', id, password: getPassword() })
}

export function seedKeychains(count) {
  return post({ action: 'seed', count, password: getPassword() })
}

export const STATUSES = ['AVAILABLE', 'ASSIGNED', 'ACTIVE', 'BLOCKED']
