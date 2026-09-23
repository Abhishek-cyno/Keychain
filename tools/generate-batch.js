#!/usr/bin/env node
/**
 * Generates everything the factory and the ops team need for one batch of
 * keychains:
 *
 *   out/qr/eqova-001.png      one QR per keychain, print-ready
 *   out/qr/eqova-001.svg      vector version for the printer
 *   out/keychains.csv         ID + URL — feed to NFC bulk writers and the sheet
 *   out/nfc-urls.txt          one URL per line, for writers that want plain text
 *   out/contact-sheet.html    printable sheet of every QR with its ID label
 *
 * Usage:
 *   node generate-batch.js --from 1 --to 500
 *   node generate-batch.js --from 501 --to 1000 --origin https://eqova.in
 *
 * Every QR encodes exactly the URL that goes on the NFC chip, and nothing else.
 * The doctor's details live behind that URL, so a keychain never needs
 * reprinting or re-encoding when the doctor's details change.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { from: 1, to: 500, origin: 'https://eqova.in', pad: 3 }

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!flag?.startsWith('--')) continue
    const key = flag.slice(2)
    if (key === 'origin') args.origin = String(value).replace(/\/$/, '')
    else if (key in args) args[key] = parseInt(value, 10)
  }

  if (!Number.isFinite(args.from) || args.from < 1) throw new Error('--from must be 1 or more')
  if (!Number.isFinite(args.to) || args.to < args.from) throw new Error('--to must be >= --from')
  if (args.to - args.from > 20000) throw new Error('Refusing to generate more than 20000 at once')

  return args
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 600,
  color: { dark: '#0f172a', light: '#ffffff' },
}

async function main() {
  const { from, to, origin, pad } = parseArgs(process.argv.slice(2))

  const outDir = join(HERE, 'out')
  const qrDir = join(outDir, 'qr')
  await mkdir(qrDir, { recursive: true })

  const ids = []
  for (let id = from; id <= to; id++) ids.push(id)

  const rows = []
  const svgs = []

  process.stdout.write(`Generating ${ids.length} keychains (${from}–${to}) for ${origin}\n`)

  for (const id of ids) {
    const label = String(id).padStart(pad, '0')
    const url = `${origin}/d/${id}`

    await QRCode.toFile(join(qrDir, `eqova-${label}.png`), url, QR_OPTIONS)

    const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
    await writeFile(join(qrDir, `eqova-${label}.svg`), svg, 'utf8')

    rows.push({ id, label, url })
    svgs.push({ label, svg })

    if (id % 50 === 0 || id === to) process.stdout.write(`  …${id}\n`)
  }

  const csv = ['ID,Label,URL,Status', ...rows.map((r) => `${r.id},${r.label},${r.url},AVAILABLE`)].join('\n')
  await writeFile(join(outDir, 'keychains.csv'), `${csv}\n`, 'utf8')

  await writeFile(join(outDir, 'nfc-urls.txt'), `${rows.map((r) => r.url).join('\n')}\n`, 'utf8')

  await writeFile(join(outDir, 'contact-sheet.html'), contactSheet(rows, svgs, origin), 'utf8')

  process.stdout.write(
    [
      '',
      'Done.',
      `  QR images       tools/out/qr/ (${rows.length * 2} files)`,
      '  Sheet import    tools/out/keychains.csv',
      '  NFC bulk write  tools/out/nfc-urls.txt',
      '  Print/QA sheet  tools/out/contact-sheet.html',
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
    <p>${rows.length} codes · each points at ${origin}/d/&lt;id&gt; · write the same URL to each NFC chip</p>
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
