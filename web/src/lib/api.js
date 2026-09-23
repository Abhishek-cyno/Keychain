/**
 * Thin client for the data layer.
 *
 * Everything the app knows about storage lives behind this module. Today it
 * talks to a Google Apps Script web app in front of a Google Sheet; swapping in
 * a Node/Express + Postgres API later means changing only VITE_API_BASE and, if
 * the shapes drift, the two mappers at the bottom of this file. The public URL
 * structure (/d/:id) never changes.
 */

const API_BASE = import.meta.env.VITE_API_BASE || ''

/**
 * With no real API configured the app falls back to an in-browser mock, so a
 * fresh clone runs and the event workflow can be rehearsed offline. Point
 * VITE_API_BASE at the Apps Script /exec URL and this switches off.
 */
export const USING_MOCK = !API_BASE || API_BASE === 'mock' || API_BASE.includes('XXXXXXXX')

export const PUBLIC_ORIGIN = (
  import.meta.env.VITE_PUBLIC_ORIGIN || window.location.origin
).replace(/\/$/, '')

export function profileUrl(id) {
  return `${PUBLIC_ORIGIN}/d/${id}`
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
  // identical GET — and that URL is single-use, so the replay 404s. Both the
  // cache-busting param and `cache: 'no-store'` are needed to stop that.
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

/* -------------------------------- public ---------------------------------- */

/** Public profile for a keychain id. Returns only public-safe fields. */
export function fetchProfile(id) {
  return get({ action: 'profile', id })
}

/* --------------------------------- admin ---------------------------------- */

export function fetchStats() {
  return get({ action: 'stats' })
}

export function fetchKeychains({ q = '', status = '', limit = 100, offset = 0 } = {}) {
  return get({ action: 'list', q, status, limit, offset })
}

export function fetchKeychain(id) {
  return get({ action: 'keychain', id })
}

/**
 * Claim an AVAILABLE keychain for a doctor.
 * `expectedStatus` is sent so the server can reject the write if another staff
 * member claimed the same id in the meantime.
 */
export function assignKeychain(id, doctor) {
  return post({ action: 'assign', id, doctor, expectedStatus: 'AVAILABLE' })
}

export function updateKeychain(id, doctor) {
  return post({ action: 'update', id, doctor })
}

export function setKeychainStatus(id, status) {
  return post({ action: 'setStatus', id, status })
}

export function seedKeychains(count) {
  return post({ action: 'seed', count })
}

export const STATUSES = ['AVAILABLE', 'ASSIGNED', 'ACTIVE', 'BLOCKED']
