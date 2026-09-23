# Event runbook

For the person at the desk. Two minutes to read.

## Before the doors open

1. Open `https://eqova.in/admin` on the desk laptop or tablet. It opens
   straight to the dashboard — no sign-in.
2. Check the **Available** tile shows the number of keychains in the box.
3. Register one test doctor against a keychain you keep aside, scan it with a
   phone, then block that keychain. If that works, the whole chain works.

Keep one phone on mobile data for checks — venue wifi is usually the first thing
to fail.

## Registering a doctor

1. Take the next keychain from the tray and read the number printed on it.
2. Type that number into the search box.
3. The row should say **AVAILABLE**. Press **Assign**.
4. Fill in what the doctor gives you. Only **name** is required — everything
   else can be added later without touching the keychain.
5. Press **Save & activate**.
6. Hand over the keychain and ask them to tap it on their phone there and then.

That last step matters. A doctor who has seen their own profile open trusts the
keychain; one who discovers it later at home has nobody to ask.

## If something goes wrong

**"Keychain #127 was just taken by another staff member."**
Another desk claimed that number a moment ago. Nothing was saved. Take the next
keychain from your tray — do not try to reuse the number.

**The doctor has already left and the details are wrong.**
Search the keychain number, press **Edit**, fix it, save. Their URL does not
change, so the keychain in their pocket now shows the corrected profile.

**A keychain is lost, or handed to the wrong person.**
Search the number, press **Block**. The URL then shows "This profile is
currently unavailable." Unblock later if it turns up.

**A doctor does not want their phone number shown.**
Leave it blank. Anything left blank simply does not appear on their profile.
Only enter details they have agreed to publish.

**The admin page will not load.**
Check the laptop is online. If other sites work and this does not, the data
layer is the problem — switch to the paper fallback below and keep the queue
moving.

## Paper fallback

If the system is unreachable, do not stop the queue. On paper, for each doctor,
record the **keychain number** and their details, and hand the keychain over
with an explanation that their profile will be live within the hour.

Anything written on paper can be entered later through the same admin screen.
The keychain number is the only part that cannot be reconstructed afterwards, so
write it first and check it twice.

## After the event

- [ ] Enter every paper fallback record.
- [ ] Filter the list by **ASSIGNED** — anything still there was started but not
      finished, and needs chasing.
- [ ] Spot-check ten profiles on a phone.
- [ ] Block the keychains that were damaged or returned.
- [ ] Redeploy the Apps Script web app (or take it offline) once the desk no
      longer needs `/admin` — the endpoint has no auth of its own.
