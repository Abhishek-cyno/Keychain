const STYLES = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ASSIGNED: 'bg-amber-50 text-amber-700 ring-amber-200',
  AVAILABLE: 'bg-slate-100 text-slate-600 ring-slate-200',
  BLOCKED: 'bg-red-50 text-red-700 ring-red-200',
}

export default function StatusBadge({ status }) {
  const key = String(status || 'AVAILABLE').toUpperCase()
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        STYLES[key] || STYLES.AVAILABLE
      }`}
    >
      {key}
    </span>
  )
}
