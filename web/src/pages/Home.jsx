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
        <Link to="/admin" className="btn-secondary mt-6 w-full">
          Admin
        </Link>
      </div>
    </div>
  )
}
