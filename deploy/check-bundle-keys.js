#!/usr/bin/env node
/**
 * Refuse to ship a build containing a privileged database key.
 *
 * This guards the one mistake in this project that could not be walked back.
 *
 * The Supabase anon key is MEANT to be in the bundle: row-level security denies
 * everything, and that key can EXECUTE exactly nine named functions (see
 * db/schema.sql). The service_role key bypasses RLS completely — published in a
 * static bundle it hands anyone who views source every doctor's email, phone
 * and address, plus write access to all 500 cards. There is no revoking a key
 * that has been served to the public internet; you rotate it and hope.
 *
 * The two look alike — both are "eyJ..." JWTs — and they sit next to each other
 * on the same Supabase dashboard page, which is precisely why this check exists
 * rather than a note in a README. So decode each JWT and read what it claims to
 * be, instead of trusting that the right one got pasted.
 *
 *   node deploy/check-bundle-keys.js [dir]     (default: web/dist)
 *
 * Exit 0 = clean, 1 = a privileged key is present.
 */

const fs = require('fs')
const path = require('path')

const root = process.argv[2] || 'web/dist'
const findings = []

function scan(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return // binary, unreadable — nothing to match anyway
  }

  // header.payload — the payload carries the role claim.
  const jwt = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})/g
  for (const match of text.matchAll(jwt)) {
    let claims
    try {
      claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'))
    } catch {
      continue // not actually a JWT
    }
    if (claims.role && claims.role !== 'anon') {
      findings.push(`${path.relative(root, file)}: JWT with role="${claims.role}"`)
    }
  }

  // Supabase's newer key format is not a JWT and says what it is in the prefix.
  if (/\bsb_secret_[A-Za-z0-9_-]+/.test(text)) {
    findings.push(`${path.relative(root, file)}: sb_secret_ key`)
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else scan(full)
  }
}

if (!fs.existsSync(root)) {
  console.error(`No such directory: ${root}`)
  process.exit(1)
}

walk(root)

if (findings.length) {
  console.error('REFUSING TO DEPLOY — a privileged key is in the build:')
  for (const f of findings) console.error(`  ${f}`)
  console.error('')
  console.error('VITE_SUPABASE_ANON_KEY in web/.env must be the anon / public key.')
  console.error('The service_role key belongs only in Apps Script Script Properties,')
  console.error('and never in anything that reaches a browser.')
  process.exit(1)
}

process.exit(0)
