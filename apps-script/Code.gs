/**
 * Eqova keychain API — Google Apps Script web app in front of a Google Sheet.
 *
 * This is the only thing that ever touches the sheet. The React app talks to
 * this; the sheet is never exposed to the browser. Replacing this with a Node +
 * Postgres service later means keeping the same request/response shapes — the
 * public URL structure (eqova.in/d/:id) is unaffected either way.
 *
 * Setup (once):
 *   1. Extensions → Apps Script from the spreadsheet that holds the data.
 *   2. Paste this file in as Code.gs.
 *   3. Run setup() once from the editor to create the sheet and its header.
 *   4. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the /exec URL into web/.env as VITE_API_BASE.
 *
 * Re-deploy (Manage deployments → edit → new version) after every code change,
 * otherwise the old version keeps serving.
 */

var SHEET_NAME = 'Keychains'

var COLUMNS = [
  'ID',
  'Name',
  'Specialization',
  'Hospital',
  'Designation',
  'Phone',
  'Email',
  'Bio',
  'LinkedIn',
  'Website',
  'Links',
  'Status',
  'Notes',
  'CreatedAt',
  'UpdatedAt',
]

var STATUSES = ['AVAILABLE', 'ASSIGNED', 'ACTIVE', 'BLOCKED']

/* ============================== HTTP ENTRY ================================ */

function doGet(e) {
  try {
    var params = (e && e.parameter) || {}
    switch (params.action) {
      case 'profile':
        return json(true, getPublicProfile(params.id))
      case 'stats':
        return json(true, getStats())
      case 'list':
        return json(true, listKeychains(params))
      case 'keychain':
        return json(true, getAdminRecord(params.id))
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

    switch (body.action) {
      case 'assign':
        return json(true, assignKeychain(body.id, body.doctor, body.expectedStatus))
      case 'update':
        return json(true, updateKeychain(body.id, body.doctor))
      case 'setStatus':
        return json(true, setKeychainStatus(body.id, body.status))
      case 'seed':
        return json(true, seedKeychains(body.count))
      default:
        return json(false, null, 'Unknown action', 'UNKNOWN_ACTION')
    }
  } catch (err) {
    return fail(err)
  }
}

/* ================================ ACTIONS ================================= */

/** Public profile. Returns only fields meant to be shown on the web page. */
function getPublicProfile(rawId) {
  var id = parseId(rawId)
  var cacheKey = 'profile_' + id
  var cache = CacheService.getScriptCache()
  var cached = cache.get(cacheKey)
  if (cached) return JSON.parse(cached)

  var row = findRow(id)
  if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')

  var record = rowToObject(row.values)
  var status = record.Status || 'AVAILABLE'
  var assigned = status === 'ACTIVE' || status === 'ASSIGNED'

  var profile = {
    id: id,
    status: status,
    assigned: assigned && Boolean(record.Name),
  }

  // Nothing about an unassigned or blocked keychain is public.
  if (profile.assigned && status !== 'BLOCKED') {
    profile.name = record.Name
    profile.specialization = record.Specialization
    profile.hospital = record.Hospital
    profile.designation = record.Designation
    profile.phone = record.Phone
    profile.email = record.Email
    profile.bio = record.Bio
    profile.linkedin = record.LinkedIn
    profile.website = record.Website
    profile.links = parseLinks(record.Links)
  }

  cache.put(cacheKey, JSON.stringify(profile), 60)
  return profile
}

/** Full record for the admin UI, internal fields included. */
function getAdminRecord(rawId) {
  var id = parseId(rawId)
  var row = findRow(id)
  if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')
  return toAdminObject(rowToObject(row.values))
}

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
      var haystack = [record.ID, record.Name, record.Hospital, record.Specialization, record.Designation]
        .join(' ')
        .toLowerCase()
      if (haystack.indexOf(query) === -1) continue
    }

    matched.push(toAdminObject(record))
  }

  return {
    total: matched.length,
    items: matched.slice(offset, offset + limit),
  }
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

/**
 * Claim an available keychain.
 *
 * The lock plus the expectedStatus re-check is what stops two staff members at
 * two laptops from handing the same keychain to two different doctors: whoever
 * gets the lock second sees the status is no longer AVAILABLE and is refused.
 */
function assignKeychain(rawId, doctor, expectedStatus) {
  var id = parseId(rawId)
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(20000)) throw apiError('The system is busy. Try again.', 'BUSY')

  try {
    var row = findRow(id)
    if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')

    var current = rowToObject(row.values)
    var currentStatus = String(current.Status || 'AVAILABLE').toUpperCase()
    var wanted = String(expectedStatus || 'AVAILABLE').toUpperCase()

    if (currentStatus !== wanted) {
      throw apiError(
        'Keychain ' + id + ' is ' + currentStatus + ', not ' + wanted + '.',
        'CONFLICT'
      )
    }
    if (current.Name) {
      throw apiError('Keychain ' + id + ' already belongs to ' + current.Name + '.', 'CONFLICT')
    }

    return writeDoctor(row, id, doctor, 'ACTIVE', current)
  } finally {
    lock.releaseLock()
  }
}

function updateKeychain(rawId, doctor) {
  var id = parseId(rawId)
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(20000)) throw apiError('The system is busy. Try again.', 'BUSY')

  try {
    var row = findRow(id)
    if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')

    var current = rowToObject(row.values)
    var currentStatus = String(current.Status || 'AVAILABLE').toUpperCase()

    // Editing never silently un-blocks a keychain.
    var nextStatus = currentStatus === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE'

    return writeDoctor(row, id, doctor, nextStatus, current)
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
    var row = findRow(id)
    if (!row) throw apiError('No keychain with that ID', 'NOT_FOUND')

    var sheet = getSheet()
    sheet.getRange(row.index, columnIndex('Status')).setValue(status)
    sheet.getRange(row.index, columnIndex('UpdatedAt')).setValue(nowIso())

    invalidate(id)
    return { id: id, status: status }
  } finally {
    lock.releaseLock()
  }
}

/**
 * Create rows for keychain IDs 1..count that do not exist yet.
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

    for (var i = 0; i < rows.length; i++) {
      var id = parseInt(rows[i][0], 10)
      if (id) existing[id] = true
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
      pending.push(blank)
    }

    if (pending.length) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, pending.length, COLUMNS.length)
        .setValues(pending)
    }

    return { created: pending.length, total: Object.keys(existing).length + pending.length }
  } finally {
    lock.releaseLock()
  }
}

/* ================================ HELPERS ================================= */

function writeDoctor(row, id, doctor, status, current) {
  var sheet = getSheet()
  var input = doctor || {}
  var timestamp = nowIso()
  var values = row.values.slice()

  function put(column, value) {
    values[columnIndex(column) - 1] = value === undefined || value === null ? '' : value
  }

  put('ID', id)
  put('Name', trim(input.name))
  put('Specialization', trim(input.specialization))
  put('Hospital', trim(input.hospital))
  put('Designation', trim(input.designation))
  put('Phone', trim(input.phone))
  put('Email', trim(input.email))
  put('Bio', trim(input.bio))
  put('LinkedIn', trim(input.linkedin))
  put('Website', trim(input.website))
  put('Links', input.links && input.links.length ? JSON.stringify(input.links) : '')
  put('Status', status)
  put('Notes', trim(input.notes))
  put('CreatedAt', current.CreatedAt || timestamp)
  put('UpdatedAt', timestamp)

  sheet.getRange(row.index, 1, 1, COLUMNS.length).setValues([values])
  invalidate(id)

  return toAdminObject(rowToObject(values))
}

function getSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = spreadsheet.getSheetByName(SHEET_NAME)
  if (!sheet) throw apiError('Sheet "' + SHEET_NAME + '" not found. Run setup() once.', 'NO_SHEET')
  return sheet
}

/** All data rows, header excluded. */
function readAll() {
  var sheet = getSheet()
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues()
}

/**
 * Locate a keychain's row. Seeded sheets are dense and sorted, so the row for
 * id N is almost always N + 1 — check there first, and only fall back to a scan
 * when someone has sorted or deleted rows by hand.
 */
function findRow(id) {
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

function rowToObject(values) {
  var record = {}
  for (var i = 0; i < COLUMNS.length; i++) {
    record[COLUMNS[i]] = values[i] === undefined ? '' : values[i]
  }
  return record
}

/** Sheet record → the camelCase shape the admin UI works with. */
function toAdminObject(record) {
  var status = String(record.Status || 'AVAILABLE').toUpperCase()
  return {
    id: parseInt(record.ID, 10),
    status: status,
    assigned: Boolean(record.Name),
    name: String(record.Name || ''),
    specialization: String(record.Specialization || ''),
    hospital: String(record.Hospital || ''),
    designation: String(record.Designation || ''),
    phone: String(record.Phone || ''),
    email: String(record.Email || ''),
    bio: String(record.Bio || ''),
    linkedin: String(record.LinkedIn || ''),
    website: String(record.Website || ''),
    links: parseLinks(record.Links),
    notes: String(record.Notes || ''),
    createdAt: asIso(record.CreatedAt),
    updatedAt: asIso(record.UpdatedAt),
  }
}

function parseLinks(value) {
  if (!value) return []
  try {
    var parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    return []
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

function invalidate(id) {
  CacheService.getScriptCache().remove('profile_' + id)
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
 * Run this once from the Apps Script editor. It creates the sheet with the
 * right header row and seeds the first 500 keychain IDs.
 */
function setup() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = spreadsheet.getSheetByName(SHEET_NAME)

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME)
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold')
    sheet.setFrozenRows(1)
  }

  seedKeychains(500)
  Logger.log('Sheet ready with ' + (sheet.getLastRow() - 1) + ' keychain rows.')
}
