/**
 * Mirror the Google Sheet into Postgres. One way only.
 *
 * THE RULE THIS FILE OBEYS
 * Nothing here ever writes to the sheet. Not a cell, not a column, not a
 * timestamp. The sheet is the record of 500 keychains that are already in
 * people's hands, and the database is a copy of it that exists purely to make
 * a tap fast.
 *
 * An earlier version synced both ways. It was wrong for this system: it meant
 * a bad database — truncated, half-imported, or wrong after some future change
 * — would copy itself over real doctors' rows on the next pass. One-way removes
 * that whole class of accident. There is no code path from Postgres to the
 * sheet, so there is nothing to get right under pressure.
 *
 * WHERE WRITES GO
 * Claims and staff edits keep going through Code.gs into the sheet, exactly as
 * they have for the 97 doctors already carrying these keychains. Code.gs then
 * calls syncRowsToDatabase() so the copy is current within the same request —
 * see "the freshly-claimed card" note there. Nothing about the write path has
 * changed, which is the point: it is the part that is proven.
 *
 * WHAT READS FROM POSTGRES
 * One thing: resolving a tapped keychain. That is the request a person waits
 * for, and it goes from ~1.5s to ~50ms. Everything else still reads the sheet.
 *
 * HOW A CHANGE IS NOTICED
 * Each row's card fields are hashed, and Postgres keeps the same digest in its
 * card_hash column. Rows whose hashes differ get pushed. Nothing is stored in
 * the sheet to track this — no bookkeeping column, no extra state — because the
 * database can simply be asked what it already has.
 *
 * SETUP
 *   1. Script Properties:
 *        SUPABASE_URL          https://<ref>.supabase.co     (origin only)
 *        SUPABASE_SERVICE_KEY  the service_role key
 *        SPREADSHEET_ID        only if this is a standalone project
 *   2. Run syncNow() once to load the sheet.
 *   3. Run installSync() to keep it current.
 *
 * The service_role key bypasses row-level security. It belongs here, in Script
 * Properties, and must never appear in the web bundle or the repository.
 */

var SYNC_DEFAULT_TAB = 'Keychains'

/** Sheet header -> the JSON key Postgres uses. */
var SYNC_FIELD_MAP = {
  Slug: 'slug',
  Status: 'status',
  Title: 'title',
  Name: 'name',
  Designation: 'designation',
  Organization: 'organization',
  Email: 'email',
  Mobile: 'mobile',
  Phone: 'phone',
  Website: 'website',
  Address: 'address',
  Remarks: 'remarks',
  Notes: 'notes',
}

/**
 * Exactly the fields Postgres hashes, in exactly that order.
 * Must stay in step with the card_hash generated column in db/schema.sql — if
 * these two ever disagree, every row looks permanently changed and the sync
 * pushes the whole sheet on every pass.
 */
var HASH_FIELDS = [
  'slug', 'status', 'title', 'name', 'designation', 'organization',
  'email', 'mobile', 'phone', 'website', 'address', 'remarks', 'notes',
]

/* ================================ CONFIG ================================== */

function syncConfig() {
  var props = PropertiesService.getScriptProperties()
  var url = String(props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '')
  var key = String(props.getProperty('SUPABASE_SERVICE_KEY') || '').trim()

  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Project Settings > Script Properties.'
    )
  }
  // Both this file and the web app append /rest/v1 themselves. A URL that
  // already ends in it produces /rest/v1/rest/v1/rpc and every call 404s.
  url = url.replace(/\/rest\/v1$/, '')
  return { url: url, key: key }
}

/** Call a Postgres function through PostgREST. */
function rpc(fn, args) {
  var cfg = syncConfig()
  var res = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
    payload: JSON.stringify(args || {}),
    muteHttpExceptions: true,
  })

  var code = res.getResponseCode()
  var body = res.getContentText()

  if (code < 200 || code >= 300) {
    throw new Error('rpc ' + fn + ' failed (' + code + '): ' + body.slice(0, 400))
  }
  return body ? JSON.parse(body) : null
}

/* ================================= HASH =================================== */

/**
 * The same digest Postgres computes in the card_hash generated column.
 *
 * 0x1F is the ASCII unit separator: it cannot appear in a pasted address or
 * phone number, so "ab"+"c" can never hash the same as "a"+"bc".
 */
function cardHash(record) {
  var parts = []
  for (var i = 0; i < HASH_FIELDS.length; i++) {
    parts.push(syncTrim(record[HASH_FIELDS[i]]))
  }

  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    parts.join('\u001f'),
    Utilities.Charset.UTF_8
  )

  var hex = ''
  for (var b = 0; b < bytes.length; b++) {
    // Apps Script bytes are signed; & 0xFF before formatting or 0x8A prints as -118.
    hex += ('0' + (bytes[b] & 0xff).toString(16)).slice(-2)
  }
  return hex
}

function syncTrim(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * Sheet dates arrive as a Date when the cell is date-formatted and as a string
 * when it is not. Postgres wants ISO-8601 either way.
 */
function syncIsoDate(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString()
  }
  var text = syncTrim(value)
  if (!text) return ''
  var parsed = new Date(text)
  return isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

/* ============================ READING THE SHEET =========================== */
/*
 * Resolved independently of Code.gs. Every .gs file in an Apps Script project
 * shares one global scope, so declaring `COLUMNS` or `getSheet` here would
 * override Code.gs's depending on file order. Everything below is prefixed
 * `sync` and collides with nothing.
 *
 * Columns are located by reading the header row rather than by a fixed
 * position, so inserting a column in the sheet cannot silently shift the sync
 * onto the wrong data.
 */

var _syncHeaders = null

function syncForget() {
  _syncHeaders = null
}

function syncSpreadsheet() {
  var active = null
  try {
    active = SpreadsheetApp.getActiveSpreadsheet()
  } catch (err) {
    active = null
  }
  if (active) return active

  var id = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim()
  if (!id) {
    throw new Error(
      'No spreadsheet. Either add this file to the Apps Script project bound to ' +
      'the keychain sheet (open the sheet > Extensions > Apps Script), or set ' +
      'SPREADSHEET_ID in Project Settings > Script Properties to the id in the ' +
      'sheet URL: docs.google.com/spreadsheets/d/<THIS PART>/edit'
    )
  }
  return SpreadsheetApp.openById(id)
}

function syncSheet() {
  var ss = syncSpreadsheet()

  // Use Code.gs's SHEET_NAME when it is in the same project, without declaring
  // it here. typeof is safe on a name that was never declared.
  var name = (typeof SHEET_NAME !== 'undefined' && SHEET_NAME) ? SHEET_NAME : SYNC_DEFAULT_TAB
  var override = String(PropertiesService.getScriptProperties().getProperty('SHEET_NAME') || '').trim()
  if (override) name = override

  var sheet = ss.getSheetByName(name)
  if (!sheet) {
    var tabs = ss.getSheets()
    var names = []
    for (var i = 0; i < tabs.length; i++) names.push(tabs[i].getName())
    throw new Error(
      'No tab named "' + name + '" in "' + ss.getName() + '". Tabs present: ' +
      names.join(', ') + '. Set SHEET_NAME in Script Properties if it is called something else.'
    )
  }
  return sheet
}

/** header text -> 1-based column, read from row 1 rather than assumed. */
function syncHeaders(sheet) {
  if (_syncHeaders) return _syncHeaders

  sheet = sheet || syncSheet()
  var width = sheet.getLastColumn()
  if (width < 1) throw new Error('The sheet is empty — no header row.')

  var row = sheet.getRange(1, 1, 1, width).getValues()[0]
  var map = {}
  for (var i = 0; i < row.length; i++) {
    var name = String(row[i]).trim()
    if (name && map[name] === undefined) map[name] = i + 1
  }

  _syncHeaders = map
  return map
}

function syncColumnIndex(name) {
  var map = syncHeaders()
  if (!map[name]) {
    var found = []
    for (var k in map) if (map.hasOwnProperty(k)) found.push(k)
    throw new Error(
      'The sheet has no "' + name + '" column. Found: ' + found.join(', ') + '.'
    )
  }
  return map[name]
}

/** One grid row -> the record shape Postgres expects. No hash. */
function rowToRecord(values, headers) {
  var record = { id: parseInt(values[syncColumnIndex('ID') - 1], 10) }

  for (var header in SYNC_FIELD_MAP) {
    if (!SYNC_FIELD_MAP.hasOwnProperty(header)) continue
    // A column the sheet does not have is simply empty, rather than fatal:
    // Notes in particular may be absent on an older sheet.
    var col = headers[header]
    record[SYNC_FIELD_MAP[header]] = col ? syncTrim(values[col - 1]) : ''
  }
  record.status = (record.status || 'AVAILABLE').toUpperCase()

  // The sheet's own timestamps travel with the row. The database is a mirror,
  // so "when was this claimed" should read the same in both places. Omitted
  // entirely when blank — sending "" makes Postgres reject the whole chunk.
  var created = headers.CreatedAt ? syncIsoDate(values[headers.CreatedAt - 1]) : ''
  var updated = headers.UpdatedAt ? syncIsoDate(values[headers.UpdatedAt - 1]) : ''
  if (created) record.createdAt = created
  if (updated) record.updatedAt = updated

  return record
}

/**
 * Read every row once, with hashes. Used for reconciliation, where the whole
 * sheet has to be compared against the whole database.
 *
 * One getValues() for the grid — 500 individual reads would not finish inside
 * the Apps Script time limit. Read-only, like everything else in this file.
 */
function readSheetRows() {
  syncForget()
  var sheet = syncSheet()
  var last = sheet.getLastRow()
  if (last < 2) return []

  var headers = syncHeaders(sheet)
  var grid = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues()
  var rows = []

  for (var i = 0; i < grid.length; i++) {
    if (!parseInt(grid[i][syncColumnIndex('ID') - 1], 10)) continue
    var record = rowToRecord(grid[i], headers)
    record.hash = cardHash(record)
    rows.push(record)
  }

  return rows
}

/**
 * Read only the rows asked for, and do NOT hash them.
 *
 * This is the path a doctor waits on. It runs inside the request that writes
 * their claim, so its cost is added directly to "Create my card".
 *
 * The full read was doing two expensive things to mirror a single row: pulling
 * all 500 rows, and calling Utilities.computeDigest 500 times — and in Apps
 * Script that digest is a service call, not a local computation. Measured
 * end to end, a one-row mirror took 13 seconds.
 *
 * Neither is needed here. The hash exists to DETECT which rows changed; when
 * the caller already knows, there is nothing to detect. And the rows wanted are
 * read as one contiguous block — seeded batches are appended together, so even
 * a hundred new keychains is a single getValues().
 */
function readRowsByIds(ids) {
  syncForget()
  var sheet = syncSheet()
  var last = sheet.getLastRow()
  if (last < 2) return []

  var headers = syncHeaders(sheet)
  var idCol = syncColumnIndex('ID')

  var wanted = {}
  for (var i = 0; i < ids.length; i++) {
    var n = parseInt(ids[i], 10)
    if (n) wanted[String(n)] = true
  }

  // Just the ID column: one narrow read, no hashing.
  var idValues = sheet.getRange(2, idCol, last - 1, 1).getValues()
  var first = 0
  var lastRow = 0
  for (var r = 0; r < idValues.length; r++) {
    var id = parseInt(idValues[r][0], 10)
    if (!id || !wanted[String(id)]) continue
    var sheetRow = r + 2
    if (!first) first = sheetRow
    lastRow = sheetRow
  }
  if (!first) return []

  var block = sheet.getRange(first, 1, lastRow - first + 1, sheet.getLastColumn()).getValues()
  var out = []
  for (var b = 0; b < block.length; b++) {
    var rowId = parseInt(block[b][idCol - 1], 10)
    if (rowId && wanted[String(rowId)]) out.push(rowToRecord(block[b], headers))
  }
  return out
}

/* ================================= SYNC =================================== */

/**
 * Push every sheet row the database does not already match.
 *
 * Safe to run at any time and safe to run twice: a pass over rows that already
 * agree sends nothing. In the steady state this is two HTTP calls and no writes
 * anywhere.
 */
function syncNow() {
  var lock = LockService.getScriptLock()

  // Wait, rather than give up after a second.
  //
  // Skipping is defensible for a scheduled pass — another one is along shortly.
  // It is not defensible when somebody has just clicked Run and is watching the
  // log: they asked for a sync and got a shrug. A pass takes about two seconds
  // in the steady state, so waiting costs nothing and the queue drains.
  if (!lock.tryLock(45000)) {
    Logger.log(
      'Gave up waiting for another sync to finish (45s).\n' +
      'Check Executions in the left sidebar for one that is still running or ' +
      'stuck. The data is not at risk — the sheet is never written by this file.'
    )
    return { skipped: 'another sync held the lock for 45s' }
  }

  try {
    var started = new Date()
    var rows = readSheetRows()
    if (!rows.length) {
      Logger.log('The sheet has no rows below the header.')
      return { sheetRows: 0, pushed: 0, note: 'sheet is empty' }
    }

    var known = rpc('sync_hashes', {}) || {}

    var pending = []
    for (var i = 0; i < rows.length; i++) {
      if (known[String(rows[i].id)] !== rows[i].hash) pending.push(rows[i])
    }

    var result = pushRows(pending)

    var summary = {
      sheetRows: rows.length,
      alreadyInStep: rows.length - pending.length,
      inserted: result.inserted,
      updated: result.updated,
      seconds: (new Date() - started) / 1000,
    }

    // Logged, not just returned. The Apps Script editor shows Logger output and
    // nothing else, so a function somebody is told to run and read has to say
    // what it did — otherwise a perfectly good pass looks like it did nothing.
    summary.verdict = pending.length === 0
      ? 'Already in step — nothing to do.'
      : 'Mirrored ' + pending.length + ' row(s) into the database.'

    Logger.log(JSON.stringify(summary, null, 2))
    return summary
  } finally {
    lock.releaseLock()
  }
}

/** Send rows to Postgres, in chunks so one payload never gets unwieldy. */
function pushRows(rows) {
  var total = { inserted: 0, updated: 0 }
  for (var c = 0; c < rows.length; c += 100) {
    var part = rpc('sync_push', { p_rows: rows.slice(c, c + 100) })
    total.inserted += part.inserted
    total.updated += part.updated
  }
  return total
}

/**
 * Mirror specific rows immediately. Called by Code.gs the moment a claim or an
 * edit lands in the sheet.
 *
 * THE FRESHLY-CLAIMED CARD
 * Without this, a doctor finishes the form, taps their keychain, and sees the
 * setup form again — because the read path is Postgres and Postgres has not
 * heard about them yet. Waiting for the next scheduled pass is not good enough
 * for the one moment they are actually watching.
 *
 * Never throws. A claim that succeeded in the sheet has succeeded, and must not
 * be reported as a failure because a mirror could not be updated; the scheduled
 * pass will catch it.
 */
function syncRowsToDatabase(ids) {
  try {
    if (!ids || !ids.length) return { pushed: 0 }

    var picked = readRowsByIds(ids)
    if (!picked.length) return { pushed: 0 }

    pushRows(picked)
    return { pushed: picked.length }
  } catch (err) {
    Logger.log('syncRowsToDatabase failed (the sheet is still correct): ' + err)
    return { pushed: 0, error: String(err) }
  }
}

/* =============================== TRIGGERS ================================= */

/** Install the scheduled reconciliation. */
function installSync() {
  removeSyncTriggers()

  var minutes = parseInt(
    PropertiesService.getScriptProperties().getProperty('SYNC_MINUTES') || '5', 10
  )
  if ([1, 5, 10, 15, 30].indexOf(minutes) === -1) minutes = 5

  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(minutes).create()

  // An installable onEdit so a correction typed straight into the sheet reaches
  // the cards in seconds rather than waiting for the next pass. It only ever
  // reads the sheet and writes to Postgres.
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(syncSpreadsheet())
    .onEdit()
    .create()

  return 'Installed: syncNow every ' + minutes + ' minutes, plus on-edit. ' +
         'Set SYNC_MINUTES in Script Properties to change the interval.'
}

function removeSyncTriggers() {
  var triggers = ScriptApp.getProjectTriggers()
  var removed = 0
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction()
    if (fn === 'syncNow' || fn === 'onSheetEdit') {
      ScriptApp.deleteTrigger(triggers[i])
      removed++
    }
  }
  return 'Removed ' + removed + ' trigger(s).'
}

/**
 * A cell was edited by hand. Mirror just the rows that changed.
 *
 * Deliberately not a full syncNow(). Every keystroke-batch in the sheet fires
 * this, and a full pass reads all 500 rows and takes the script lock — so a
 * person tidying up a few cells would queue several passes that block each
 * other and burn the daily trigger quota. Pushing only the edited rows needs no
 * lock and finishes in well under a second.
 *
 * The scheduled pass is still the safety net for anything this misses.
 */
function onSheetEdit(e) {
  try {
    if (!e || !e.range) return

    var target = syncSheet()
    if (e.range.getSheet().getName() !== target.getName()) return

    var firstRow = Math.max(e.range.getRow(), 2) // never the header
    var lastRow = e.range.getRow() + e.range.getNumRows() - 1
    if (lastRow < firstRow) return

    var idCol = syncColumnIndex('ID')
    var values = target.getRange(firstRow, idCol, lastRow - firstRow + 1, 1).getValues()

    var ids = []
    for (var i = 0; i < values.length; i++) {
      var id = parseInt(values[i][0], 10)
      if (id) ids.push(id)
    }

    if (ids.length) syncRowsToDatabase(ids)
  } catch (err) {
    Logger.log('onSheetEdit: ' + err)
  }
}

/* ============================== DIAGNOSTICS =============================== */

/**
 * Read-only. Answers "does the database match the sheet?" without changing
 * anything — the first thing to run when a card shows the wrong details.
 */
function syncStatus() {
  var rows = readSheetRows()
  var known = rpc('sync_hashes', {}) || {}

  var identical = 0
  var behind = []
  var missing = []

  for (var i = 0; i < rows.length; i++) {
    var have = known[String(rows[i].id)]
    if (have === undefined) missing.push(rows[i].id)
    else if (have === rows[i].hash) identical++
    else behind.push(rows[i].id)
  }

  var inSheet = {}
  for (var j = 0; j < rows.length; j++) inSheet[String(rows[j].id)] = true
  var extra = []
  for (var id in known) {
    if (known.hasOwnProperty(id) && !inSheet[id]) extra.push(parseInt(id, 10))
  }

  var report = {
    sheetRows: rows.length,
    databaseRows: Object.keys(known).length,
    identical: identical,
    databaseBehind: behind.slice(0, 20),
    notInDatabaseYet: missing.slice(0, 20),
    // Rows the database has and the sheet does not. Not deleted automatically:
    // this file does not delete, and a surprise here is worth a human look.
    inDatabaseOnly: extra.slice(0, 20),
    triggers: describeSyncTriggers(),
  }

  if (identical === rows.length && !extra.length) {
    report.verdict = 'In step. Every sheet row matches the database.'
  } else {
    report.verdict = 'Out of step — run syncNow().'
  }

  Logger.log(JSON.stringify(report, null, 2))
  return report
}

function describeSyncTriggers() {
  var triggers = ScriptApp.getProjectTriggers()
  var names = []
  for (var i = 0; i < triggers.length; i++) names.push(triggers[i].getHandlerFunction())
  return names
}

/**
 * The first load. Kept as a separate name because it is what the setup notes
 * tell you to run, but it is the ordinary pass — there is no special import
 * path to get wrong.
 */
function importSheetToDatabase() {
  return syncNow()
}
