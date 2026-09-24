import mark from '../assets/eqova-mark.png'

const SITE = 'https://www.eqova.in'

/**
 * The Eqova Medicare sign-off at the bottom of every screen a tapped keychain
 * can land on.
 *
 * Uses the logo mark rather than the full wordmark: at the size this sits at,
 * "eqova MEDICARE" would be about four pixels tall and unreadable, and the
 * wordmark would only repeat the text beside it. The brand kit ships the mark
 * as a standalone asset for exactly this.
 *
 * Imported as a module rather than referenced from public/, so Vite emits it
 * under the production base path — a bare /mark.png would 404 once the app is
 * mounted at /keychain-app/.
 */
export default function BrandFooter({ className = '' }) {
  return (
    <footer className={`px-6 py-4 text-center ${className}`}>
      <p className="flex items-center justify-center gap-2 text-[13px] leading-none text-slate-500">
        <img src={mark} alt="" width="96" height="120" className="h-[17px] w-auto" />
        <span>
          Powered by <span className="font-bold text-eqova-navy">Eqova Medicare</span>
        </span>
      </p>

      <p className="mt-2 text-[11px] leading-none text-slate-500">
        We make medicines
        <span className="px-1.5 text-slate-300">·</span>
        <a
          href={SITE}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-eqova-navy underline-offset-2 hover:underline"
        >
          Know more
        </a>
      </p>
    </footer>
  )
}
