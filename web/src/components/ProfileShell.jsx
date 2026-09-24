/**
 * The frame every tapped-keychain screen sits in — card, claim form, or
 * notice. Shared so the three outcomes of a tap look like one product.
 */

export function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-700 via-brand-600 to-slate-50">
      <div className="mx-auto w-full max-w-md px-4 pb-10 pt-8">{children}</div>
    </div>
  )
}

export function Notice({ title, body, children }) {
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-xl shadow-brand-900/15">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
        <svg
          className="h-7 w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5m0 3.5v.01" strokeLinecap="round" />
        </svg>
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{body}</p>
      {children}
      <p className="mt-6 text-xs text-slate-400">
        Powered by <span className="font-semibold text-slate-500">Eqova</span>
      </p>
    </div>
  )
}

export default Shell
