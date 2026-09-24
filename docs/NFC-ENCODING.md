# Writing the NFC chips

Each chip holds one thing: its own URL. Nothing else.

```
Keychain #001  →  https://eqova.in/d/4g6yhtstvm
Keychain #127  →  https://eqova.in/d/k7mq2xdv9p
Keychain #500  →  https://eqova.in/d/w42vkg4yar
```

The code is **random and unique per keychain — not the number**. `/d/1` resolves
to nothing on purpose: a sequential URL would let anyone claim or read any
keychain by counting.

No name, no phone number. That is what makes the keychain permanent: the holder
can change their details any time without the chip being touched.

## Codes come from the backend

They are generated when the rows are seeded, and this tool reads them back:

```bash
cd tools
npm install
node generate-batch.js --api "<your /exec URL>" --origin https://eqova.in
```

Generating codes locally would produce QR codes that resolve to nothing.

`out/keychains.csv` is the pairing record between the printed number and the
encoded code — `ID,Label,Code,URL`. Keep it. It is how you answer "which
keychain is this?" later.

## Record type

Write a **URI / URL record** (NDEF), not plain text. A text record shows the
holder a string instead of opening their browser.

Include the `https://` prefix. The NDEF URI record type compresses it to a
single byte, so it costs nothing and guarantees the phone treats it as a link.

Any NTAG213 (144 bytes) or larger is plenty — these URLs are about 30 bytes.

## Bulk writing

`out/nfc-urls.txt` (one URL per line) and `out/keychains.csv` feed whichever
writer you use:

- **NXP TagWriter** (Android) — *Write from dataset* accepts the CSV.
- **NFC Tools Pro** (Android/iOS) — batch task list from the text file.
- **Desktop encoders** (ACR122U + `nfc-tools`, or a vendor's bulk station).

If the keychain vendor does the encoding, send them `keychains.csv` and one
instruction: *write column D as an NDEF URI record to the chip in the keychain
physically labelled with column B*.

Order matters more than it used to. Previously a mis-paired chip sent someone to
the wrong number; now it sends them to someone else's **code**.

## Verify before locking

For each chip, or a sample of at least 10% of the batch:

1. Tap it with a phone — the set-up form should open.
2. Check the code in the URL matches that number's row in `keychains.csv`.
3. Scan the printed QR on the same keychain — it must open the same URL.

**Do not press "Create my card" while testing.** Claiming is one-way: a claimed
keychain cannot be handed out, and resetting it issues a new code that no longer
matches what is printed on it.

A keychain encoded with another keychain's code is the one error that cannot be
fixed later in software — two people end up sharing a card, and whoever taps
first claims it. Physically separate any mismatched keychains rather than trying
to correct the sheet around them.

## Lock the tags

After writing, set each tag **read-only** (every writer offers this). An
unlocked tag can be silently overwritten by anyone with a phone — including at
the event. This is irreversible, so verify first.

## Matching the printed number

`out/contact-sheet.html` prints every QR with its number underneath. Use it as
the QA sheet: it is the fastest way to walk a tray of keychains and confirm the
label, the QR and the chip all agree.
