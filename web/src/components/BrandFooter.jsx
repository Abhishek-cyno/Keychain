import logo from '../assets/eqova-medicare-logo.png'

const SITE = 'https://www.eqova.in'

/**
 * The Eqova Medicare sign-off, shown at the bottom of every screen a tapped
 * keychain can land on.
 *
 * Imported as a module rather than referenced from public/, so Vite emits it
 * under the production base path — a bare /logo.png would 404 once the app is
 * mounted at /keychain-app/.
 */
export default function BrandFooter({ className = '' }) {
  return (
    <footer className={`px-6 py-6 text-center ${className}`}>
      {/* slate-500 rather than 400: at 11px uppercase on a near-white card,
          slate-400 sits around 2.8:1 contrast — under the 4.5:1 AA floor. */}
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        Powered by Eqova Medicare
      </p>

      <img
        src={logo}
        alt="Eqova Medicare"
        width="340"
        height="185"
        className="mx-auto mt-3 h-auto w-[150px] max-w-full"
      />

      <p className="mt-3 text-sm font-semibold text-eqova-navy">We make medicines</p>

      <a
        href={SITE}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-eqova-navy underline-offset-4 hover:underline"
      >
        Know more
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </footer>
  )
}
