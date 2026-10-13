import { useEffect, useRef, useState } from 'react'
import { claimKeychain } from '../lib/api.js'
import { Shell } from '../components/ProfileShell.jsx'
import BrandFooter from '../components/BrandFooter.jsx'
import DoctorFields, { EMPTY_DOCTOR, cleanDoctor, validateDoctor } from '../components/DoctorFields.jsx'
import { AVATARS_ENABLED, prepareAvatar, uploadAvatar } from '../lib/avatar.js'

/**
 * What someone sees when they tap a keychain nobody has set up yet.
 *
 * Possession of the physical keychain is the only authority needed — there is
 * no staff member in this loop and no password. That is the point of the
 * unguessable code in the URL: it is the credential.
 */
export default function ClaimCard({ slug, number, onClaimed }) {
  const [form, setForm] = useState(EMPTY_DOCTOR)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [claimed, setClaimed] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [step, setStep] = useState('')
  const [photoFailed, setPhotoFailed] = useState(false)

  useEffect(() => {
    document.title = 'Set up your card · Eqova'
  }, [])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(e) {
    e.preventDefault()

    const problem = validateDoctor(form)
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setSaving(true)

    // Claim first, upload second, and never the other way round.
    //
    // The storage policy only accepts a photo for a keychain that is already
    // claimed, so this order is required — but it is also the order that fails
    // well. The claim is the irreversible part; the photo is not. If the
    // upload fails the card still exists and is correct, and the photo can be
    // added later by tapping the avatar.
    let profile
    try {
      setStep('Saving your details…')
      profile = await claimKeychain(slug, cleanDoctor(form))
    } catch (err) {
      setError(err.message || 'Could not save your details. Please try again.')
      setSaving(false)
      setStep('')
      return
    }

    if (photo && AVATARS_ENABLED) {
      try {
        setStep('Adding your photo…')
        await uploadAvatar(slug, photo)
      } catch (err) {
        // Deliberately not surfaced as a failure: the card is live. Telling
        // somebody their card did not work, when it did, is worse than a
        // missing photo they can add in one tap.
        console.warn('[eqova] card created, photo upload failed:', err.message)
        setPhotoFailed(true)
      }
    }

    setStep('')
    setClaimed(profile)
  }

  if (claimed) {
    return (
      <Shell>
        <div className="overflow-hidden rounded-3xl bg-white text-center shadow-xl shadow-brand-900/15">
          <div className="px-8 pb-6 pt-8">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <svg
              className="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Your card is live</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Anyone who taps this keychain now sees your details. Tap it yourself any time to open
            your card.
          </p>
          {photoFailed && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
              Your card is ready, but the photo did not upload. Ask the Eqova team to add it.
            </p>
          )}
          <button type="button" className="btn-primary mt-6 w-full" onClick={() => onClaimed(claimed)}>
            View my card
          </button>
          </div>
          <BrandFooter className="border-t border-slate-100" />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        {/* <header className="rounded-3xl bg-white p-6 text-center shadow-xl shadow-brand-900/15">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-lg font-bold text-white">
            E
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Set up your digital card</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            This keychain is not linked to anyone yet. Fill in your details and it becomes yours —
            anyone who taps or scans it will see your card.
          </p>
          {number ? (
            <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Keychain <span className="font-mono font-semibold text-slate-700">#{String(number).padStart(3, '0')}</span>
              {' '}— check this matches the number on yours.
            </p>
          ) : null}
        </header> */}

        {AVATARS_ENABLED && (
          <PhotoPicker
            blob={photo}
            onPick={setPhoto}
            onClear={() => setPhoto(null)}
            disabled={saving}
          />
        )}

        <DoctorFields form={form} onChange={update} />

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="card space-y-3 p-5">
          <p className="text-xs leading-relaxed text-slate-500">
            Once you save, this keychain is linked to you. You will not be able to change it
            yourself afterwards — contact the Eqova team if anything needs correcting.
          </p>
          <button type="submit" className="btn-primary w-full !py-3" disabled={saving}>
            {saving ? step || 'Saving…' : 'Create my card'}
          </button>
        </div>

        <BrandFooter />
      </form>
    </Shell>
  )
}

/**
 * Choosing a photo while setting the card up.
 *
 * The file is resized here, the moment it is picked, rather than at submit:
 * the person is still filling in fields so the work is free, the preview is
 * the actual image that will be stored, and a file the browser cannot read is
 * reported now — before the claim, which cannot be undone.
 */
function PhotoPicker({ blob, onPick, onClear, disabled }) {
  const [preview, setPreview] = useState('')
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (!blob) {
      setPreview('')
      return undefined
    }
    const url = URL.createObjectURL(blob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  async function choose(event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = '' // or picking the same file twice fires nothing
    if (!file) return

    setProblem('')
    setWorking(true)
    try {
      onPick(await prepareAvatar(file))
    } catch (err) {
      setProblem(err.message || 'Could not read that image.')
      onPick(null)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="card p-5 text-center">
      <button
        type="button"
        onClick={() => fileRef.current && fileRef.current.click()}
        disabled={disabled || working}
        className="relative mx-auto grid h-[92px] w-[92px] place-items-center overflow-hidden rounded-full border-4 border-white bg-brand-50 text-brand-500 shadow-lg shadow-brand-900/10 transition active:scale-[0.97]"
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 8.5h3l1.5-2h7L17 8.5h3v10H4v-10Z" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.4" />
          </svg>
        )}

        {working && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-white/75">
            <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
          </span>
        )}
      </button>

      <p className="mt-3 text-[13px] font-semibold text-slate-700">
        {blob ? 'Photo ready' : 'Add your photo'}
      </p>
      {/* <p className="mt-0.5 text-[12px] text-slate-400">
        {blob ? 'Tap the circle to choose a different one.' : 'Optional — your initials are used otherwise.'}
      </p> */}

      {blob && !working && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 text-[12px] font-semibold text-slate-500 underline-offset-2 hover:underline"
        >
          Remove
        </button>
      )}

      {problem && <p className="mt-2 text-[12px] font-medium text-red-600">{problem}</p>}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={choose} />
    </div>
  )
}
