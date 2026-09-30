import BrandFooter from './BrandFooter.jsx'

/**
 * The frame every tapped-keychain screen sits in — card, claim form, or
 * notice. Shared so the three outcomes of a tap look like one product.
 */

/**
 * min-h-dvh rather than min-h-screen: 100vh on a phone measures the viewport
 * WITHOUT the browser's address bar, so anything sized to it overflows by
 * exactly the height of that bar. dvh tracks the space actually visible.
 * min-h-screen stays in front of it as the fallback.
 *
 * 10px above, 30px below, and a column that grows: the card fills the screen
 * bar a thin margin, rather than floating in it. The extra room underneath
 * keeps the footer clear of a phone's home indicator. Spare height is absorbed
 * inside the card rather than collecting above or below it.
 *
 * The background stays blue all the way down. It used to fade to near-white,
 * which turned any leftover space into a pale band that read as the page
 * having run out rather than as a margin.
 */
export function Shell({ children }) {
  return (
    <div className="flex min-h-screen min-h-dvh flex-col bg-gradient-to-b from-brand-600 via-brand-700 to-brand-800">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-[30px] pt-[10px]">{children}</div>
    </div>
  )
}

export function Notice({ title, body, children }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-white text-center shadow-xl shadow-brand-900/15">
      <div className="px-8 pb-6 pt-8">
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
      </div>
      <BrandFooter className="border-t border-slate-100" />
    </div>
  )
}

export default Shell
