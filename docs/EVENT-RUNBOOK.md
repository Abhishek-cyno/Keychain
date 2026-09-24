# Event runbook

For the person at the desk. Two minutes to read.

**The big change: you no longer register anyone.** You hand over a keychain,
they tap it, they fill in their own details. Your job is to make that first tap
happen in front of you, and to fix what goes wrong.

## Before the doors open

1. Open `https://eqova.in/admin` on the desk laptop. The dashboard opens without
   a password; you only need one to edit.
2. Check the **Unclaimed** tile matches the number of keychains in the box.
3. Take one keychain aside and run it yourself: tap it, fill in a test name,
   confirm the card appears. Then **Reset** it — note this issues a new code, so
   put that keychain aside rather than handing it out.
4. Make sure you know the staff password, and that it is not written anywhere a
   visitor can see.

Keep one phone on mobile data. Venue wifi is usually the first thing to fail.

## Handing over a keychain

1. Take the next keychain from the tray.
2. Give it to them and ask them to tap it on their phone **there and then**.
3. The setup form opens. They fill it in and press **Create my card**.
4. Ask them to tap it once more, so they see their own card.

That last step matters. Someone who has seen their card open trusts the
keychain; someone who discovers it at home has nobody to ask.

If their phone has no NFC, the QR code on the keychain does exactly the same
thing — any camera app.

## What they will ask

**"Who can see this?"**
Anything they type is public to anyone who taps or scans that keychain. Blank
fields simply do not appear. Only name is required.

**"Can I change it later?"**
Not themselves — the form says so before they submit. Send them to the Eqova
team and staff can edit it.

**"Do I need an app or an account?"**
No. It opens in the browser.

## If something goes wrong

**They filled it in wrong, or it is someone else's details.**
Search the keychain number in admin, press **Edit**, enter the staff password,
fix it, save.

**Someone claimed the wrong keychain entirely.**
Find it, press **Reset**, enter the password. This erases the card **and issues
a new code**, so the link printed on that physical keychain stops working. Set
that keychain aside — do not hand it out again.

**A keychain is lost or should stop working.**
Find it, press **Block**. The URL then shows "currently unavailable" instead of
that person's phone number.

**"This keychain has already been set up."**
Someone claimed it before. Give them a different one and flag it for review.

**The admin page will not load.**
Check the laptop is online. Handing out keychains does not need the admin page
at all — people can claim without you. Keep the queue moving.

## Paper fallback

If people cannot claim on the spot — no signal, dead phone — write down the
**keychain number** against their name and hand it over anyway. They can tap it
later anywhere with signal.

Do not collect their details on paper expecting to enter them yourself: staff
cannot claim a keychain, only edit one that has been claimed.

## After the event

- [ ] Filter by **Unclaimed** to see how many went out without being set up.
- [ ] Spot-check ten cards on a phone.
- [ ] Block the keychains that were damaged or returned.
- [ ] Change `ADMIN_PASSWORD` in Script Properties so event-day staff can no
      longer edit. No redeploy needed.
