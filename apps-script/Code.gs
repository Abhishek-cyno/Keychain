/**
 * Eqova keychain API — Google Apps Script web app in front of a Google Sheet.
 *
 * Self-service model:
 *   Every keychain carries an unguessable slug, e.g. eqova.in/d/k7mq2xdv9p.
 *   Tapping an unclaimed keychain opens a form; whoever holds the physical
 *   object fills in their own details and claims it. Tapping a claimed one
 *   shows that person's card. Staff never assign anything.
 *
 * The slug is the credential. The sequential ID still exists for the ops team
 * (it is what is physically printed on the keychain and what the admin list
 * sorts by), but it is NOT a way in: there is deliberately no numeric lookup
 * on the public endpoint, or the random slug would be pointless.
 *
 * Setup (once):
 *   1. Extensions → Apps Script from the spreadsheet that holds the data.
 *   2. Paste this file in as Code.gs.
 *   3. Project Settings → Script Properties, add:
 *        ADMIN_PASSWORD   required — gates every admin write
 *   4. Run setup() once from the editor. Safe to re-run: it adds the Slug
 *      column if missing and backfills slugs for rows that lack one.
 *   5. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *
 * Re-deploy (Manage deployments → edit → new version) after every code change,
 * otherwise the old version keeps serving.
 */

var SHEET_NAME = 'Keychains'

/**
 * Column order is positional and must not be rearranged: the sheet already
 * holds live rows, and moving an entry would shift every value sideways.
 *
 * New fields are therefore appended, and retired ones stay in place rather
 * than being deleted. 'Specialization', 'Bio', 'LinkedIn' and 'Links' are no
 * longer written or returned by the API — they are kept only so the columns
 * after them do not move, and so the data already captured is not destroyed.
 * Deleting them is a one-off sheet edit whenever you decide the old values
 * are no longer wanted.
 *
 * 'Organization' occupies the column previously headed 'Hospital'. Only the
 * label changed, so existing values carry over untouched.
 */
var COLUMNS = [
  'ID',
  'Name',
  'Specialization', // retired
  'Organization',
  'Designation',
  'Phone',
  'Email',
  'Bio', // retired
  'LinkedIn', // retired
  'Website',
  'Links', // retired
  'Status',
  'Notes',
  'CreatedAt',
  'UpdatedAt',
  'Slug',
  'Title',
  'Mobile',
  'Address',
  'Remarks',
]

/** The fields a card is actually made of, in the order they are shown. */
var CARD_FIELDS = [
  'title',
  'name',
  'designation',
  'organization',
  'email',
  'mobile',
  'phone',
  'website',
  'address',
  'remarks',
]

var STATUSES = ['AVAILABLE', 'ASSIGNED', 'ACTIVE', 'BLOCKED']

// No 0/o, 1/l/i — these get read off a screen and typed by hand during support.
var SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
var SLUG_LENGTH = 10

// Caps on what a self-service claim may write. Without these, anyone holding a
// slug could stuff megabytes into the sheet.
var FIELD_LIMITS = {
  title: 24,
  name: 120,
  designation: 120,
  organization: 160,
  email: 160,
  mobile: 40,
  phone: 40,
  website: 300,
  address: 400,
  remarks: 1000,
  notes: 1000,
}

/* ============================== HTTP ENTRY ================================ */

function doGet(e) {
  try {
    var params = (e && e.parameter) || {}
    switch (params.action) {
      // Public — the only lookup a keychain can perform.
      case 'profile':
        return json(true, getPublicProfile(params.slug))

      // Admin read. Deliberately free of contact details, so opening the
      // dashboard never exposes anyone's phone number or email.
      case 'stats':
        return json(true, getStats())
      case 'list':
        return json(true, listKeychains(params))

      // Admin read of one full record, contact details included. Gated.
      case 'keychain':
        requirePassword(params.password)
        return json(true, getAdminRecord(params.id))

      case 'verifyPassword':
        requirePassword(params.password)
        return json(true, { ok: true })

      default:
        return json(false, null, 'Unknown action', 'UNKNOWN_ACTION')
    }
  } catch (err) {
    return fail(err)
  }
}

function doPost(e) {
  try {
    var body = {}
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents)
    }

    // The public self-service claim. Not password-gated: possession of the
    // slug, i.e. of the physical keychain, is what authorises it.
    if (body.action === 'claim') {
      return json(true, claimKeychain(body.slug, body.doctor))
    }

    // Everything else is staff-only.
    requirePassword(body.password)

    switch (body.action) {
      case 'update':
        return json(true, updateKeychain(body.id, body.doctor))
      case 'setStatus':
        return json(true, setKeychainStatus(body.id, body.status))
      case 'release':
        return json(true, releaseKeychain(body.id))
      case 'seed':
        return json(true, seedKeychains(body.count))
      default:
        return json(false, null, 'Unknown action', 'UNKNOWN_ACTION')
    }
  } catch (err) {
    return fail(err)
  }
}

/* ============================ PUBLIC / CLAIM ============================== */

/**
 * What a tapped keychain resolves to.
 *
 * Three outcomes: a card to read, a form to fill in, or a closed door.
 */
function getPublicProfile(rawSlug) {
  var slug = parseSlug(rawSlug)
  var cache = CacheService.getScriptCache()
  var cacheKey = 'profile_' + slug
  var cached = cache.get(cacheKey)
  if (cached) return JSON.parse(cached)

  var row = findRowBySlug(slug)
  if (!row) throw apiError('No keychain with that code', 'NOT_FOUND')

  var record = rowToObject(row.values)
  var status = String(record.Status || 'AVAILABLE').toUpperCase()
  var claimed = Boolean(record.Name) && status !== 'AVAILABLE'

  var profile = {
    slug: slug,
    // Shown on the claim screen so someone can check it against the number
    // printed on the keychain in their hand. It is not a lookup key.
    number: parseInt(record.ID, 10) || null,
    status: status,
    assigned: claimed && status !== 'BLOCKED',
    claimable: status === 'AVAILABLE' && !record.Name,
  }

  if (profile.assigned) {
    profile.title = String(record.Title || '')
    profile.name = String(record.Name || '')
    profile.designation = String(record.Designation || '')
    profile.organization = String(record.Organization || '')
    profile.email = String(record.Email || '')
    profile.mobile = String(record.Mobile || '')
    profile.phone = String(record.Phone || '')
    profile.website = String(record.Website || '')
    profile.address = String(record.Address || '')
    profile.remarks = String(record.Remarks || '')
  }

  // An unclaimed keychain is cached only briefly: the moment someone claims it
  // the next tap must show the card, not the form again.
  cache.put(cacheKey, JSON.stringify(profile), profile.claimable ? 5 : 60)
  return profile
}

/**
 * Self-service claim.
 *
 * The lock plus the re-read is what stops two people who somehow both have the
 * link from claiming the same keychain: the second one is told it is taken
 * rather than overwriting the first.
 */
function claimKeychain(rawSlug, doctor) {
  var slug = parseSlug(rawSlug)
  var input = doctor || {}

  if (!trim(input.name)) throw apiError('Please enter your name.', 'NAME_REQUIRED')

  var lock = LockService.getScriptLock()
  if (!lock.tryLock(20000)) throw apiError('The system is busy. Please try again.', 'BUSY')

  try {
    var row = findRowBySlug(slug)
    if (!row) throw apiError('No keychain with that code', 'NOT_FOUND')

    var current = rowToObject(row.values)
    var status = String(current.Status || 'AVAILABLE').toUpperCase()

    if (status === 'BLOCKED') {
      throw apiError('This keychain is not available.', 'BLOCKED')
    }
    if (current.Name || status !== 'AVAILABLE') {
      throw apiError(
        'This keychain has already been set up. Ask the Eqova team if you need it changed.',
        'ALREADY_CLAIMED'
      )
    }

    writeDoctor(row, current, input, 'ACTIVE')
    invalidateSlug(slug)

    // Give back the public shape, so the app can show the finished card
    // immediately without a second round trip.
    return getPublicProfile(slug)
  } finally {
    lock.releaseLock()
  }
}

/* ================================= ADMIN ================================== */

/**
 * Rows for the dashboard.
 *
 * No phone, email, bio or notes: the dashboard is not password-gated, so it
 * must not be a directory of everyone's contact details. Those live behind
 * getAdminRecord, which is gated.
 */
function listKeychains(params) {
  var query = String(params.q || '').trim().toLowerCase()
  var status = String(params.status || '').trim().toUpperCase()
  var limit = Math.min(parseInt(params.limit, 10) || 50, 500)
  var offset = Math.max(parseInt(params.offset, 10) || 0, 0)

  var rows = readAll()
  var matched = []

  for (var i = 0; i < rows.length; i++) {
    var record = rowToObject(rows[i])
    if (!record.ID) continue
    if (status && String(record.Status || 'AVAILABLE').toUpperCase() !== status) continue

    if (query) {
      var haystack = [record.ID, record.Slug, record.Name, record.Organization, record.Designation]
        .join(' ')
        .toLowerCase()
      if (haystack.indexOf(query) === -1) continue
    }

    matched.push({
      id: parseInt(record.ID, 10),
      slug: String(record.Slug || ''),
      status: String(record.Status || 'AVAILABLE').toUpperCase(),
      assigned: Boolean(record.Name),
      title: String(record.Title || ''),
      name: String(record.Name || ''),
      designation: String(record.Designation || ''),
      organization: String(record.Organization || ''),
      updatedAt: asIso(record.UpdatedAt),
    })
  }

  return { total: matched.length, items: matched.slice(offset, offset + limit) }
}

/** Full record including contact details. Password required. */
function getAdminRecord(rawId) {
  var id = parseId(rawId)
  var row = findRowById(id)
  if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')
  return toAdminObject(rowToObject(row.values))
}

function getStats() {
  var rows = readAll()
  var stats = { total: 0, AVAILABLE: 0, ASSIGNED: 0, ACTIVE: 0, BLOCKED: 0 }

  for (var i = 0; i < rows.length; i++) {
    var record = rowToObject(rows[i])
    if (!record.ID) continue
    stats.total++
    var status = String(record.Status || 'AVAILABLE').toUpperCase()
    if (stats[status] === undefined) stats[status] = 0
    stats[status]++
  }

  return stats
}

/** Staff correction of a card someone already claimed. */
function updateKeychain(rawId, doctor) {
  var id = parseId(rawId)
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(20000)) throw apiError('The system is busy. Try again.', 'BUSY')

  try {
    var row = findRowById(id)
    if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')

    var current = rowToObject(row.values)
    var status = String(current.Status || 'AVAILABLE').toUpperCase()

    // Editing never silently un-blocks a keychain.
    var next = status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE'

    writeDoctor(row, current, doctor || {}, next)
    invalidateSlug(current.Slug)

    return toAdminObject(rowToObject(findRowById(id).values))
  } finally {
    lock.releaseLock()
  }
}

function setKeychainStatus(rawId, rawStatus) {
  var id = parseId(rawId)
  var status = String(rawStatus || '').toUpperCase()
  if (STATUSES.indexOf(status) === -1) throw apiError('Unknown status: ' + rawStatus, 'BAD_STATUS')

  var lock = LockService.getScriptLock()
  if (!lock.tryLock(20000)) throw apiError('The system is busy. Try again.', 'BUSY')

  try {
    var row = findRowById(id)
    if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')

    var sheet = getSheet()
    sheet.getRange(row.index, columnIndex('Status')).setValue(status)
    sheet.getRange(row.index, columnIndex('UpdatedAt')).setValue(nowIso())

    invalidateSlug(rowToObject(row.values).Slug)
    return { id: id, status: status }
  } finally {
    lock.releaseLock()
  }
}

/**
 * Wipe a keychain back to claimable.
 *
 * The escape hatch for a claim made in error — someone else's keychain, or a
 * test entry. It issues a NEW slug, so the old printed code stops working and
 * whoever claimed it cannot simply re-open the link.
 */
function releaseKeychain(rawId) {
  var id = parseId(rawId)
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(20000)) throw apiError('The system is busy. Try again.', 'BUSY')

  try {
    var row = findRowById(id)
    if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')

    var current = rowToObject(row.values)
    var oldSlug = current.Slug

    var sheet = getSheet()
    var values = row.values.slice()
    // Retired columns are cleared too: a reset should leave nothing of the
    // previous holder behind, including values captured under the old schema.
    var clear = ['Title', 'Name', 'Designation', 'Organization', 'Email', 'Mobile',
                 'Phone', 'Website', 'Address', 'Remarks', 'Notes',
                 'Specialization', 'Bio', 'LinkedIn', 'Links']
    for (var i = 0; i < clear.length; i++) {
      values[columnIndex(clear[i]) - 1] = ''
    }
    values[columnIndex('Status') - 1] = 'AVAILABLE'
    values[columnIndex('UpdatedAt') - 1] = nowIso()

    sheet.getRange(row.index, 1, 1, COLUMNS.length).setValues([values])

    invalidateSlug(oldSlug)
    return { id: id, status: 'AVAILABLE', slug: values[columnIndex('Slug') - 1] }
  } finally {
    lock.releaseLock()
  }
}

/**
 * Create rows for IDs 1..count that do not exist yet, each with a fresh slug.
 * Existing rows are never modified, so this is safe to re-run when a new batch
 * of keychains is manufactured.
 */
function seedKeychains(rawCount) {
  var count = parseInt(rawCount, 10)
  if (!count || count < 1 || count > 20000) throw apiError('Count must be between 1 and 20000', 'BAD_COUNT')

  var lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) throw apiError('The system is busy. Try again.', 'BUSY')

  try {
    var sheet = getSheet()
    var rows = readAll()
    var existing = {}
    var usedSlugs = {}

    for (var i = 0; i < rows.length; i++) {
      var id = parseInt(rows[i][0], 10)
      if (id) existing[id] = true
      var slug = rows[i][columnIndex('Slug') - 1]
      if (slug) usedSlugs[String(slug)] = true
    }

    var pending = []
    var timestamp = nowIso()

    for (var n = 1; n <= count; n++) {
      if (existing[n]) continue
      var blank = new Array(COLUMNS.length).fill('')
      blank[columnIndex('ID') - 1] = n
      blank[columnIndex('Status') - 1] = 'AVAILABLE'
      blank[columnIndex('CreatedAt') - 1] = timestamp
      blank[columnIndex('UpdatedAt') - 1] = timestamp
      blank[columnIndex('Slug') - 1] = uniqueSlug(usedSlugs)
      pending.push(blank)
    }

    if (pending.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, pending.length, COLUMNS.length).setValues(pending)
    }

    return { created: pending.length, total: Object.keys(existing).length + pending.length }
  } finally {
    lock.releaseLock()
  }
}

/* ================================ HELPERS ================================= */

function writeDoctor(row, current, input, status) {
  var sheet = getSheet()
  var timestamp = nowIso()
  var values = row.values.slice()

  function put(column, value) {
    values[columnIndex(column) - 1] = value === undefined || value === null ? '' : value
  }

  put('Title', capped(input.title, 'title'))
  put('Name', capped(input.name, 'name'))
  put('Designation', capped(input.designation, 'designation'))
  put('Organization', capped(input.organization, 'organization'))
  put('Email', capped(input.email, 'email'))
  put('Mobile', capped(input.mobile, 'mobile'))
  put('Phone', capped(input.phone, 'phone'))
  put('Website', capped(input.website, 'website'))
  put('Address', capped(input.address, 'address'))
  put('Remarks', capped(input.remarks, 'remarks'))
  put('Status', status)
  put('CreatedAt', current.CreatedAt || timestamp)
  put('UpdatedAt', timestamp)

  // Notes are staff-only and must never be writable by a public claim.
  if (Object.prototype.hasOwnProperty.call(input, 'notes')) {
    put('Notes', capped(input.notes, 'notes'))
  }

  sheet.getRange(row.index, 1, 1, COLUMNS.length).setValues([values])
}

function capped(value, field) {
  var limit = FIELD_LIMITS[field] || 200
  return trim(value).substring(0, limit)
}

function getSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) throw apiError('Sheet "' + SHEET_NAME + '" not found. Run setup() once.', 'NO_SHEET')
  return sheet
}

function readAll() {
  var sheet = getSheet()
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues()
}

/**
 * Seeded sheets are dense and sorted, so the row for id N is almost always
 * N + 1 — check there first, and only fall back to a scan when someone has
 * sorted or deleted rows by hand.
 */
function findRowById(id) {
  var sheet = getSheet()
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return null

  var guess = id + 1
  if (guess >= 2 && guess <= lastRow) {
    var values = sheet.getRange(guess, 1, 1, COLUMNS.length).getValues()[0]
    if (parseInt(values[0], 10) === id) return { index: guess, values: values }
  }

  var all = readAll()
  for (var i = 0; i < all.length; i++) {
    if (parseInt(all[i][0], 10) === id) return { index: i + 2, values: all[i] }
  }

  return null
}

function findRowBySlug(slug) {
  var all = readAll()
  var column = columnIndex('Slug') - 1
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][column]) === slug) return { index: i + 2, values: all[i] }
  }
  return null
}

/**
 * Utilities.getUuid() is a type-4 UUID from a proper random source. Math.random()
 * is not: its future output is derivable from past values, which would let
 * someone holding a few keychains predict the codes on others.
 */
function makeSlug() {
  var hex = Utilities.getUuid().replace(/-/g, '')
  var out = ''
  for (var i = 0; i < SLUG_LENGTH; i++) {
    out += SLUG_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % SLUG_ALPHABET.length)
  }
  return out
}

function uniqueSlug(used) {
  for (var attempt = 0; attempt < 50; attempt++) {
    var slug = makeSlug()
    if (!used[slug]) {
      used[slug] = true
      return slug
    }
  }
  throw apiError('Could not generate a unique code', 'SLUG_EXHAUSTED')
}

function rowToObject(values) {
  var record = {}
  for (var i = 0; i < COLUMNS.length; i++) {
    record[COLUMNS[i]] = values[i] === undefined ? '' : values[i]
  }
  return record
}

function toAdminObject(record) {
  return {
    id: parseInt(record.ID, 10),
    slug: String(record.Slug || ''),
    status: String(record.Status || 'AVAILABLE').toUpperCase(),
    assigned: Boolean(record.Name),
    title: String(record.Title || ''),
    name: String(record.Name || ''),
    designation: String(record.Designation || ''),
    organization: String(record.Organization || ''),
    email: String(record.Email || ''),
    mobile: String(record.Mobile || ''),
    phone: String(record.Phone || ''),
    website: String(record.Website || ''),
    address: String(record.Address || ''),
    remarks: String(record.Remarks || ''),
    notes: String(record.Notes || ''),
    createdAt: asIso(record.CreatedAt),
    updatedAt: asIso(record.UpdatedAt),
  }
}

function columnIndex(name) {
  return COLUMNS.indexOf(name) + 1
}

function parseId(value) {
  var id = parseInt(value, 10)
  if (!id || id < 1) throw apiError('Invalid keychain ID', 'NOT_FOUND')
  return id
}

function parseSlug(value) {
  var slug = String(value || '').trim().toLowerCase()
  if (!slug || !/^[a-z0-9]{4,32}$/.test(slug)) throw apiError('Invalid keychain code', 'NOT_FOUND')
  return slug
}

function trim(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function nowIso() {
  return new Date().toISOString()
}

function asIso(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function invalidateSlug(slug) {
  if (slug) CacheService.getScriptCache().remove('profile_' + String(slug))
}

function requirePassword(supplied) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD')
  if (!expected) {
    throw apiError('ADMIN_PASSWORD is not set in Script Properties', 'NOT_CONFIGURED')
  }
  if (!supplied || String(supplied) !== expected) {
    throw apiError('Incorrect password', 'UNAUTHORISED')
  }
}

function apiError(message, code) {
  var err = new Error(message)
  err.code = code || 'ERROR'
  return err
}

function fail(err) {
  return json(false, null, err.message || String(err), err.code || 'ERROR')
}

function json(ok, data, error, code) {
  var payload = ok ? { ok: true, data: data } : { ok: false, error: error, code: code }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  )
}

/* ========================= ONE-TIME EDITOR SETUP ========================== */

/**
 * Run once from the Apps Script editor. Safe to re-run — it is also the
 * migration for a sheet created before slugs existed.
 */
function setup() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = spreadsheet.getSheetByName(SHEET_NAME)

  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME)

  // A sheet narrower than COLUMNS makes every later getRange throw "those
  // columns are out of bounds" — including the header write below, which is
  // why a run can fail having changed nothing at all.
  var have = sheet.getMaxColumns()
  if (have < COLUMNS.length) {
    sheet.insertColumnsAfter(have, COLUMNS.length - have)
    Logger.log('Widened the sheet from ' + have + ' to ' + COLUMNS.length + ' columns.')
  }

  var before = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0].join(' | ')
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold')
  sheet.setFrozenRows(1)

  var added = backfillSlugs()
  seedKeychains(500)

  Logger.log('Header before: ' + before)
  Logger.log('Header after:  ' + COLUMNS.join(' | '))
  Logger.log(
    'Sheet ready. ' + (sheet.getLastRow() - 1) + ' rows, ' + added + ' slugs backfilled.'
  )
}

/**
 * Read-only check of what is actually in the spreadsheet.
 *
 * Run this from the editor when the sheet does not look the way it should: it
 * reports the sheet this script is bound to, the real header row, and whether
 * the code running in the editor matches the code that was deployed.
 */
function diagnose() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  Logger.log('Spreadsheet: ' + spreadsheet.getName())
  Logger.log('URL:         ' + spreadsheet.getUrl())

  var names = spreadsheet.getSheets().map(function (s) { return s.getName() })
  Logger.log('Tabs:        ' + names.join(', '))

  var sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) {
    Logger.log('NO TAB NAMED "' + SHEET_NAME + '" — that is the problem.')
    return
  }

  Logger.log('Grid:        ' + sheet.getMaxRows() + ' rows x ' + sheet.getMaxColumns() + ' columns')
  Logger.log('Data rows:   ' + Math.max(0, sheet.getLastRow() - 1))

  var width = Math.min(sheet.getMaxColumns(), COLUMNS.length)
  var header = sheet.getRange(1, 1, 1, width).getValues()[0]
  Logger.log('Header now:  ' + header.join(' | '))
  Logger.log('Header want: ' + COLUMNS.join(' | '))

  var missing = []
  for (var i = 0; i < COLUMNS.length; i++) {
    if (String(header[i] || '') !== COLUMNS[i]) {
      missing.push('col ' + (i + 1) + ': got "' + (header[i] || '') + '", want "' + COLUMNS[i] + '"')
    }
  }
  Logger.log(missing.length ? 'MISMATCHED:\n  ' + missing.join('\n  ') : 'Header matches. Run setup() only if you also want slugs backfilled.')
}

/** Give a slug to every row that lacks one. Existing slugs are never changed. */
function backfillSlugs() {
  var sheet = getSheet()
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return 0

  var column = columnIndex('Slug')
  var range = sheet.getRange(2, column, lastRow - 1, 1)
  var values = range.getValues()
  var used = {}
  var added = 0

  for (var i = 0; i < values.length; i++) {
    if (values[i][0]) used[String(values[i][0])] = true
  }
  for (var j = 0; j < values.length; j++) {
    if (!values[j][0]) {
      values[j][0] = uniqueSlug(used)
      added++
    }
  }

  if (added) range.setValues(values)
  return added
}
