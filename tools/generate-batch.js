#!/usr/bin/env node
/**
 * Generates everything the factory and the ops team need for one batch of
 * keychains:
 *
 *   out/qr/eqova-001.png      one QR per keychain, print-ready
 *   out/qr/eqova-001.svg      vector version for the printer
 *   out/keychains.csv         number + code + URL, for NFC writers and records
 *   out/nfc-urls.txt          one URL per line, for writers that want plain text
 *   out/contact-sheet.html    printable sheet of every QR with its number
 *
 * Codes are NOT generated here. Each keychain's code is created by the backend
 * when its row is seeded, and this tool reads them back — inventing them
 * locally would produce QR codes that resolve to nothing.
 *
 * Usage:
 *   node generate-batch.js --api https://script.google.com/macros/s/AAA.../exec
 *   node generate-batch.js --api <url> --from 1 --to 500
 *   node generate-batch.js --csv exported-sheet.csv        # offline fallback
 *
 * The --csv form takes a sheet exported as CSV and needs an ID column and a
 * Slug column; everything else in the file is ignored.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { from: 1, to: 0, origin: 'https://eqova.in', pad: 3, api: '', csv: '' }

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!flag?.startsWith('--')) continue
    const key = flag.slice(2)
    if (key === 'origin') args.origin = String(value).replace(/\/$/, '')
    else if (key === 'api' || key === 'csv') args[key] = String(value || '')
    else if (key in args) args[key] = parseInt(value, 10)
  }

  if (!args.api && !args.csv) {
    throw new Error('Pass --api <exec-url> to read the codes, or --csv <file> for the offline path')
  }
  if (!Number.isFinite(args.from) || args.from < 1) throw new Error('--from must be 1 or more')
  if (args.to && args.to < args.from) throw new Error('--to must be >= --from')

  return args
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 600,
  color: { dark: '#0f172a', light: '#ffffff' },
}

/** Read every keychain from the live API. `list` needs no password. */
async function loadFromApi(api) {
  const url = new URL(api)
  url.searchParams.set('action', 'list')
  url.searchParams.set('limit', '500')

  const all = []
  let offset = 0

  // The API caps a page at 500, so walk until a page comes back short.
  for (;;) {
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('_', String(Date.now()))

    const res = await fetch(url, { redirect: 'follow' })
    const text = await res.text()

    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(`API did not return JSON. Is --api the /exec URL?\n${text.slice(0, 200)}`)
    }
    if (!payload.ok) throw new Error(payload.error || 'API request failed')

    all.push(...payload.data.items)
    offset += payload.data.items.length

    if (payload.data.items.length === 0 || all.length >= payload.data.total) break
  }

  return all.map((row) => ({ id: Number(row.id), slug: String(row.slug || '') }))
}

/** Offline path: a sheet exported as CSV, with ID and Slug columns. */
async function loadFromCsv(path) {
  const text = await readFile(path, 'utf8')
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (!lines.length) throw new Error('The CSV is empty')

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const idAt = header.indexOf('id')
  const slugAt = header.indexOf('slug')
  if (idAt === -1 || slugAt === -1) {
    throw new Error(`The CSV needs an ID column and a Slug column. Found: ${header.join(', ')}`)
  }

  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    return { id: Number(cells[idAt]), slug: String(cells[slugAt] || '').trim() }
  })
}

async function main() {
  const { from, to, origin, pad, api, csv } = parseArgs(process.argv.slice(2))

  process.stdout.write(`Reading keychains from ${api ? 'the API' : csv}\n`)
  const all = api ? await loadFromApi(api) : await loadFromCsv(csv)

  const selected = all
    .filter((r) => r.id >= from && (!to || r.id <= to))
    .sort((a, b) => a.id - b.id)

  const missing = selected.filter((r) => !r.slug)
  if (missing.length) {
    throw new Error(
      `${missing.length} keychain(s) have no code, starting at #${missing[0].id}. ` +
        'Run setup() in the Apps Script editor to backfill them, then try again.'
    )
  }
  if (!selected.length) {
    throw new Error(`No keychains in range ${from}–${to || '∞'}`)
  }

  const outDir = join(HERE, 'out')
  const qrDir = join(outDir, 'qr')
  await mkdir(qrDir, { recursive: true })

  const rows = []
  const svgs = []

  process.stdout.write(`Generating ${selected.length} keychains for ${origin}\n`)

  for (const { id, slug } of selected) {
    const label = String(id).padStart(pad, '0')
    const url = `${origin}/d/${slug}`

    await QRCode.toFile(join(qrDir, `eqova-${label}.png`), url, QR_OPTIONS)
    const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
    await writeFile(join(qrDir, `eqova-${label}.svg`), svg, 'utf8')

    rows.push({ id, label, slug, url })
    svgs.push({ label, svg })

    if (rows.length % 50 === 0 || id === selected[selected.length - 1].id) {
      process.stdout.write(`  …${rows.length}\n`)
    }
  }

  const csvOut = [
    'ID,Label,Code,URL',
    ...rows.map((r) => `${r.id},${r.label},${r.slug},${r.url}`),
  ].join('\n')
  await writeFile(join(outDir, 'keychains.csv'), `${csvOut}\n`, 'utf8')
  await writeFile(join(outDir, 'nfc-urls.txt'), `${rows.map((r) => r.url).join('\n')}\n`, 'utf8')
  await writeFile(join(outDir, 'contact-sheet.html'), contactSheet(rows, svgs, origin), 'utf8')

  process.stdout.write(
    [
      '',
      'Done.',
      `  QR images       tools/out/qr/ (${rows.length * 2} files)`,
      '  Pairing record  tools/out/keychains.csv',
      '  NFC bulk write  tools/out/nfc-urls.txt',
      '  Print/QA sheet  tools/out/contact-sheet.html',
      '',
      'Each QR is labelled with the keychain number but encodes that keychain\'s',
      'own code. Check a sample against keychains.csv before the batch is printed.',
      '',
    ].join('\n')
  )
}

function contactSheet(rows, svgs, origin) {
  const cells = svgs
    .map(
      ({ label, svg }) => `    <figure class="cell">
      ${svg.replace('<svg', '<svg class="qr"')}
      <figcaption>#${label}</figcaption>
    </figure>`
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eqova keychain batch ${rows[0].label}–${rows[rows.length - 1].label}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; background: #fff; }
  header { margin-bottom: 20px; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  p { margin: 0; color: #64748b; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
  .cell { margin: 0; text-align: center; break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
  .qr { width: 100%; height: auto; display: block; }
  figcaption { margin-top: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 700; }
  @media print { body { padding: 8mm; } .cell { border-color: #cbd5e1; } header { margin-bottom: 8mm; } }
</style>
</head>
<body>
  <header>
    <h1>Eqova keychains ${rows[0].label}–${rows[rows.length - 1].label}</h1>
    <p>${rows.length} codes · each encodes ${origin}/d/&lt;its own code&gt; · write the same URL to that keychain's NFC chip</p>
  </header>
  <div class="grid">
${cells}
  </div>
</body>
</html>
`
}

main().catch((err) => {
  process.stderr.write(`\nFailed: ${err.message}\n`)
  process.exitCode = 1
})
