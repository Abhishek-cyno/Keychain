import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Check the link on your keychain. Profile links look like <span className="font-mono">eqova.in/d/127</span>.
        </p>
        <Link to="/" className="btn-secondary mt-6 w-full">
          Go to Eqova
        </Link>
      </div>
    </div>
  )
}
