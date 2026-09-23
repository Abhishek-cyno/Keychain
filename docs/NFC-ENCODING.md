# Writing the NFC chips

Each chip holds one thing: its own URL. Nothing else.

```
Keychain #1     →  https://eqova.in/d/1
Keychain #127   →  https://eqova.in/d/127
Keychain #500   →  https://eqova.in/d/500
```

No name, no phone number, no hospital. That is what makes the keychain
permanent: a doctor moving hospitals changes a row in a sheet, not a chip.

## Record type

Write a **URI / URL record** (NDEF), not plain text. A text record shows the
doctor a string instead of opening their browser.

Include the `https://` prefix. The NDEF URI record type compresses it to a
single byte, so it costs nothing and guarantees the phone treats it as a link.

Any NTAG213 (144 bytes) or larger is plenty — the longest URL here is about 25
bytes.

## Bulk writing

`tools/out/nfc-urls.txt` (one URL per line) and `tools/out/keychains.csv`
(`ID,Label,URL,Status`) are produced by:

```bash
cd tools
npm install
node generate-batch.js --from 1 --to 500 --origin https://eqova.in
```

Feed either file to whichever writer you use:

- **NXP TagWriter** (Android) — *Write from dataset* accepts the CSV.
- **NFC Tools Pro** (Android/iOS) — batch task list from the text file.
- **Desktop encoders** (ACR122U + `nfc-tools`, or a vendor's bulk station) — the
  CSV maps ID to URL, which is what the encoding station needs.

If the keychain vendor does the encoding, send them `keychains.csv` and one
instruction: *write column C as an NDEF URI record to the chip in the keychain
physically labelled with column B*.

## Lock the tags

After writing, set the tag **read-only** (every writer offers this). An unlocked
tag can be silently overwritten by anyone with a phone — including at the event.
This is irreversible, so verify first.

## Verify before locking

For each chip, or a sample of at least 10% of the batch:

1. Tap it with a phone — the browser should open `eqova.in/d/<id>`.
2. Check the number in the URL matches the number printed on the keychain.
3. Scan the printed QR on the same keychain — it must open the same URL.

A mismatch between the printed number and the encoded number is the one error
that cannot be fixed later in software: the doctor receives someone else's
profile. Physically separate any mismatched keychains rather than trying to
correct the sheet around them.

## Matching the printed number

`tools/out/contact-sheet.html` prints every QR with its ID underneath. Use it as
the QA sheet: it is the fastest way for someone to walk a tray of keychains and
confirm the physical label, the QR and the chip all agree.
