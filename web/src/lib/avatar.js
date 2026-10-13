/**
 * Profile photos.
 *
 * A photo is chosen once, while the keychain is being set up. The finished
 * card only displays it — there is no edit affordance there, and the storage
 * policy grants INSERT and not UPDATE so the server agrees.
 *
 * WHERE THE PHOTO LIVES
 * In Supabase Storage, at a path derived from the slug. There is no column for
 * it — not in the sheet, not in Postgres — because the address is a pure
 * function of the code:
 *
 *   tap.eqova.in/k7mq2xdv9p  ->  .../storage/v1/object/public/avatars/k7mq2xdv9p.webp
 *
 * That is worth more than it looks. Uploading writes nothing to the sheet, so
 * the sheet stays the source of truth for everything it holds, photos stay out
 * of the one-way sync entirely, and there is no second place for the two to
 * disagree. The card asks for the image and shows initials if it 404s; the
 * absence of a file IS the "no photo" state.
 *
 * WHY THIS DOES NOT SLOW A TAP DOWN
 * The card data is 366 bytes and arrives in ~50ms. The photo is a separate,
 * parallel request that nothing waits for: initials paint immediately and the
 * image replaces them when it arrives, so time-to-first-paint is unchanged
 * whether a photo exists or not.
 *
 * The upload resizes in the browser first, which is the part that actually
 * matters. A phone photo is 3-8MB; this sends ~40KB. Unresized, a few hundred
 * card views would cost more bandwidth than the entire text of the app has
 * used since it launched.
 */

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const AVATARS_ENABLED = Boolean(URL_BASE && ANON_KEY)

const BUCKET = 'avatars'

/** Longest edge of the stored image. The card renders it at 92-116px. */
const SIZE = 512

/** Anything larger than this after resizing is a bug, not a photo. */
const MAX_BYTES = 300 * 1024

/**
 * Where a keychain's photo would be, whether or not one exists.
 *
 * No cache-buster in the normal case: the CDN should cache these hard, since
 * the same card gets tapped repeatedly. `version` is passed only right after
 * an upload, by the one browser that needs to see past the cache.
 */
/**
 * How long a viewer may keep showing a photo after it has been replaced.
 *
 * The filename is derived from the slug, so a slug that gets reused — a card
 * cleared and set up again by somebody else — reuses the filename too. Caching
 * that hard means the new owner's card showing the previous owner's face, so
 * the URL carries a coarse clock that moves every few minutes and quietly
 * retires every cached copy.
 */
const CACHE_WINDOW_MS = 5 * 60 * 1000

export function avatarUrl(slug, version) {
  if (!AVATARS_ENABLED || !slug) return ''
  const base = `${URL_BASE}/storage/v1/object/public/${BUCKET}/${slug}.webp`

  // An explicit version is the upload path saying "show mine now, never mind
  // the clock". Otherwise bucket by time: identical within a window, so the
  // CDN still serves repeat taps, and different across one, so a replacement
  // cannot be hidden for longer than that.
  const v = version || Math.floor(Date.now() / CACHE_WINDOW_MS)
  return `${base}?v=${v}`
}

export class AvatarError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'AvatarError'
    this.code = code || 'ERROR'
  }
}

/**
 * Resize to square, centre-cropped, WebP. Does not upload.
 *
 * Exported so the claim form can do this the moment a photo is chosen: the
 * person is still filling in fields, the work is free, and an unreadable file
 * is reported before anything irreversible happens rather than after their
 * keychain has been claimed.
 *
 * Centre-crop rather than letterbox because the card shows the result in a
 * circle: anything that is not square gets cropped by the circle regardless,
 * and doing it here means what is uploaded is what will be seen.
 *
 * Falls back to JPEG where WebP encoding is unavailable. The bucket accepts
 * both, and the stored name still ends .webp — the policy matches on the name,
 * and browsers go by the Content-Type, not the extension.
 */
export async function prepareAvatar(file) {
  const bitmap = await loadBitmap(file)

  const edge = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - edge) / 2
  const sy = (bitmap.height - edge) / 2

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE

  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, SIZE, SIZE)

  if (bitmap.close) bitmap.close()

  const blob =
    (await encode(canvas, 'image/webp', 0.85)) || (await encode(canvas, 'image/jpeg', 0.85))

  if (!blob) throw new AvatarError('This browser could not process the image.', 'ENCODE_FAILED')
  return blob
}

function encode(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      // toBlob yields null for a type the browser cannot encode, which is how
      // the WebP-then-JPEG fallback above decides.
      canvas.toBlob((b) => resolve(b && b.type === type ? b : null), type, quality)
    } catch {
      resolve(null)
    }
  })
}

async function loadBitmap(file) {
  // createImageBitmap honours EXIF orientation when asked, which matters: a
  // photo taken in portrait on a phone is stored rotated, and an <img> would
  // show it on its side.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* Safari <15 and friends — fall through to the <img> path */
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new AvatarError('That file is not an image.', 'NOT_AN_IMAGE'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/**
 * Resize and upload. Resolves to the URL to show, with a cache-buster.
 *
 * Authority is possession of the keychain, exactly as it is for claiming —
 * there is no password here. What stops the bucket being an open file host is
 * the storage policy, not this function: it accepts a write only to
 * "<slug>.webp" for a keychain that exists and is claimed, so the public key
 * can address at most 500 unguessable filenames and create none of them. See
 * db/storage.sql.
 */
export async function uploadAvatar(slug, file) {
  if (!AVATARS_ENABLED) throw new AvatarError('Photo uploads are not configured.', 'DISABLED')
  if (!file) throw new AvatarError('No file chosen.', 'NO_FILE')

  if (!/^image\//.test(file.type || '')) {
    throw new AvatarError('Please choose an image.', 'NOT_AN_IMAGE')
  }

  // Already prepared by the claim form? Send it as-is rather than re-encoding
  // a WebP that was produced by this same code a moment ago.
  const prepared =
    file instanceof Blob && !(file instanceof File) && /^image\/(webp|jpeg)$/.test(file.type)

  const blob = prepared ? file : await prepareAvatar(file)

  if (blob.size > MAX_BYTES) {
    throw new AvatarError('That image is too large even after resizing.', 'TOO_LARGE')
  }

  let res
  try {
    res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${slug}.webp`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': blob.type,
        // Upsert, because a reused keychain may still be carrying the
        // previous owner's file. Without this the new owner's upload is
        // refused with 409 and their photo goes nowhere. The policy only
        // allows the overwrite while the card is freshly set up.
        'x-upsert': 'true',
        // Minutes, not a year. The filename is reused whenever a slug is, so
        // a long cache is how a new owner ends up wearing the old owner's
        // face. Repeat taps inside the window still come from the CDN.
        'Cache-Control': 'public, max-age=300',
      },
      body: blob,
    })
  } catch (err) {
    throw new AvatarError('Could not reach the photo service. Check your connection.', 'UNREACHABLE')
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).message || ''
    } catch {
      /* non-JSON error body */
    }

    // 403 is the storage policy refusing, and it refuses for two quite
    // different reasons: the keychain is not claimed yet, or it already has a
    // photo and the public key may not replace one. Reporting the first when
    // it is the second sends somebody off to fix a card that is already fine.
    if (res.status === 400 || res.status === 403) {
      const alreadyThere = /row-level security/i.test(detail)
      throw new AvatarError(
        alreadyThere
          ? 'This keychain already has a photo. Ask the Eqova team to change it.'
          : 'This keychain cannot take a photo yet. Set up the card first.',
        alreadyThere ? 'ALREADY_HAS_PHOTO' : 'NOT_ALLOWED'
      )
    }
    if (res.status === 409) {
      throw new AvatarError('This keychain already has a photo.', 'ALREADY_HAS_PHOTO')
    }
    if (res.status === 413) {
      throw new AvatarError('That image is too large.', 'TOO_LARGE')
    }
    throw new AvatarError(detail || `Upload failed (${res.status}).`, 'UPLOAD_FAILED')
  }

  return avatarUrl(slug, Date.now())
}

/* --------------------------------- staff ---------------------------------- */
/*
 * Replacing and removing need permissions the public key does not have. Rather
 * than handing the browser a privileged key, the database is asked to open a
 * two-minute window for one slug once the staff password checks out; the
 * upload then goes straight to storage with the ordinary anon key, and the
 * window is closed again immediately.
 *
 * So the password never leaves Postgres' hands, the service key never leaves
 * Script Properties, and the browser holds nothing it did not already have.
 */

async function rpc(fn, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })

  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new AvatarError('The database returned an unexpected response.', 'BAD_RESPONSE')
  }

  if (!res.ok) {
    const raw = (payload && payload.message) || ''
    const sep = raw.indexOf('|')
    if (sep > 0 && /^[A-Z_]+$/.test(raw.slice(0, sep))) {
      throw new AvatarError(raw.slice(sep + 1), raw.slice(0, sep))
    }
    throw new AvatarError(raw || `Request failed (${res.status}).`, 'ERROR')
  }
  return payload
}

/** Replace a card's photo. Resolves to the URL to show. */
export async function replaceAvatar(id, password, file) {
  if (!AVATARS_ENABLED) throw new AvatarError('Photos are not configured.', 'DISABLED')

  const blob = await prepareAvatar(file)
  if (blob.size > MAX_BYTES) {
    throw new AvatarError('That image is too large even after resizing.', 'TOO_LARGE')
  }

  const { slug } = await rpc('admin_unlock_photo', { p_id: Number(id), p_password: password })

  try {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${slug}.webp`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': blob.type,
        // Permitted here and nowhere else: the grant just created is what the
        // UPDATE policy looks for.
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=300',
      },
      body: blob,
    })

    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.json()).message || ''
      } catch {
        /* non-JSON body */
      }
      throw new AvatarError(detail || `Upload failed (${res.status}).`, 'UPLOAD_FAILED')
    }
  } finally {
    // Close the window whether or not the upload worked, so a failure does not
    // leave the card editable by anyone who knows its code.
    try {
      await rpc('admin_lock_photo', { p_id: Number(id) })
    } catch {
      /* it expires on its own in two minutes regardless */
    }
  }

  return avatarUrl(slug, Date.now())
}

/** Remove a card's photo. The card falls back to initials. */
export async function removeAvatar(id, password) {
  if (!AVATARS_ENABLED) throw new AvatarError('Photos are not configured.', 'DISABLED')

  const { slug } = await rpc('admin_unlock_photo', { p_id: Number(id), p_password: password })

  try {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${slug}.webp`, {
      method: 'DELETE',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    })
    // 404 means there was nothing there, which is the state asked for.
    if (!res.ok && res.status !== 404) {
      throw new AvatarError(`Could not remove the photo (${res.status}).`, 'DELETE_FAILED')
    }
  } finally {
    try {
      await rpc('admin_lock_photo', { p_id: Number(id) })
    } catch {
      /* expires on its own */
    }
  }

  return true
}
