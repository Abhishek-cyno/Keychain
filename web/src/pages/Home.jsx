import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-700 to-brand-500 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-lg font-bold text-white">
          E
        </span>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Eqova</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Tap your Eqova keychain on your phone, or scan its QR code, to open the profile it belongs to.
        </p>
        {/* The padlock says the staff area is locked before anyone clicks it,
            rather than letting them find out at the password prompt. */}
        <Link to="/admin" className="btn-secondary mt-6 w-full">
          <svg
            className="h-4 w-4 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
            <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" strokeLinecap="round" />
          </svg>
          Admin
        </Link>
      </div>
    </div>
  )
}
