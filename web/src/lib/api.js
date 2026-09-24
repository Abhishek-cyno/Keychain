/**
 * Thin client for the data layer.
 *
 * Everything the app knows about storage lives behind this module. Today it
 * talks to a Google Apps Script web app in front of a Google Sheet; swapping in
 * a Node/Express + Postgres API later means changing only VITE_API_BASE.
 *
 * Keychains are addressed by an unguessable slug, never by their sequential
 * number. The number exists for the ops team and is printed on the physical
 * object; it is deliberately not a way to reach a profile.
 */

const API_BASE = import.meta.env.VITE_API_BASE || ''

/**
 * With no real API configured the app falls back to an in-browser mock, so a
 * fresh clone runs and the claim flow can be rehearsed offline.
 */
export const USING_MOCK = !API_BASE || API_BASE === 'mock' || API_BASE.includes('XXXXXXXX')

export const PUBLIC_ORIGIN = (
  import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin
).replace(/\/$/, '')

export function profileUrl(slug) {
  return `${PUBLIC_ORIGIN}/d/${slug}`
}

export class ApiError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ApiError'
    this.code = code || 'ERROR'
  }
}

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
 */
export function fetchProfile(slug) {
  return get({ action: 'profile', slug })
}

/** Self-service claim. No password — holding the keychain is the authority. */
export function claimKeychain(slug, doctor) {
  return post({ action: 'claim', slug, doctor })
}

/* ------------------------------- staff only -------------------------------- */

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
