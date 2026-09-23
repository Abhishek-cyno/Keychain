import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchStats,
  fetchKeychains,
  setKeychainStatus,
  seedKeychains,
  profileUrl,
  STATUSES,
} from '../lib/api.js'
import Spinner from '../components/Spinner.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

const PAGE_SIZE = 50

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(
    async ({ q, status, from }) => {
      setLoading(true)
      setError('')
      try {
        const [statsData, list] = await Promise.all([
          fetchStats(),
          fetchKeychains({ q, status, limit: PAGE_SIZE, offset: from }),
        ])
        setStats(statsData)
        setRows(list.items)
        setTotal(list.total)
      } catch (err) {
        setError(err.message || 'Could not load keychains.')
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Debounce the search box so typing does not hammer the Apps Script quota.
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0)
      load({ q: query, status: statusFilter, from: 0 })
    }, query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [query, statusFilter, load])

  function reload() {
    load({ q: query, status: statusFilter, from: offset })
  }

  function goToPage(next) {
    setOffset(next)
    load({ q: query, status: statusFilter, from: next })
  }

  async function toggleBlock(row) {
    const next = row.status === 'BLOCKED' ? (row.assigned ? 'ACTIVE' : 'AVAILABLE') : 'BLOCKED'
    const verb = next === 'BLOCKED' ? 'Block' : 'Unblock'
    if (!window.confirm(`${verb} keychain #${row.id}?`)) return

    setBusyId(row.id)
    try {
      await setKeychainStatus(row.id, next)
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)))
      fetchStats().then(setStats, () => {})
    } catch (err) {
      window.alert(err.message || 'Could not change the status.')
    } finally {
      setBusyId(null)
    }
  }

  const pageLabel = useMemo(() => {
    if (!total) return '0 keychains'
    const first = offset + 1
    const last = Math.min(offset + rows.length, total)
    return `${first}–${last} of ${total}`
  }, [offset, rows.length, total])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Keychains</h1>
          <p className="text-sm text-slate-500">Assign a keychain to a doctor, or edit an existing profile.</p>
        </div>
        <SeedButton onDone={reload} />
      </div>

      <StatsRow stats={stats} />

      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              className="input pl-9"
              placeholder="Search by keychain ID, doctor, hospital or specialization"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputMode="search"
            />
          </div>
          <select
            className="input sm:w-48"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <Spinner label="Loading keychains" />
      ) : rows.length === 0 ? (
        <EmptyState hasFilters={Boolean(query || statusFilter)} />
      ) : (
        <>
          <KeychainTable rows={rows} busyId={busyId} onToggleBlock={toggleBlock} />
          <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
            <span>{pageLabel}</span>
            <div className="flex gap-2">
              <button
                className="btn-secondary !py-2 !text-xs"
                disabled={offset === 0}
                onClick={() => goToPage(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                className="btn-secondary !py-2 !text-xs"
                disabled={offset + rows.length >= total}
                onClick={() => goToPage(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function StatsRow({ stats }) {
  const tiles = [
    { label: 'Total', value: stats?.total, tone: 'text-slate-900' },
    { label: 'Available', value: stats?.AVAILABLE, tone: 'text-slate-600' },
    { label: 'Assigned', value: stats?.ASSIGNED, tone: 'text-amber-600' },
    { label: 'Active', value: stats?.ACTIVE, tone: 'text-emerald-600' },
    { label: 'Blocked', value: stats?.BLOCKED, tone: 'text-red-600' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div key={tile.label} className="card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{tile.label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${tile.tone}`}>
            {tile.value === undefined || tile.value === null ? '—' : tile.value}
          </p>
        </div>
      ))}
    </div>
  )
}

function KeychainTable({ rows, busyId, onToggleBlock }) {
  return (
    <div className="card overflow-hidden">
      {/* Desktop */}
      <table className="hidden w-full text-left text-sm md:table">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">ID</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Doctor</th>
            <th className="px-4 py-3 font-semibold">Hospital</th>
            <th className="px-4 py-3 font-semibold">Updated</th>
            <th className="px-4 py-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-mono font-semibold tabular-nums text-slate-900">
                {String(row.id).padStart(3, '0')}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3">
                {row.name ? (
                  <div>
                    <div className="font-medium text-slate-900">{row.name}</div>
                    {row.specialization && (
                      <div className="text-xs text-slate-500">{row.specialization}</div>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{row.hospital || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{formatDate(row.updatedAt)}</td>
              <td className="px-4 py-3">
                <RowActions row={row} busy={busyId === row.id} onToggleBlock={onToggleBlock} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
                    #{String(row.id).padStart(3, '0')}
                  </span>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-1 truncate font-medium text-slate-900">
                  {row.name || <span className="font-normal text-slate-400">Unassigned</span>}
                </p>
                {(row.specialization || row.hospital) && (
                  <p className="truncate text-xs text-slate-500">
                    {[row.specialization, row.hospital].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3">
              <RowActions row={row} busy={busyId === row.id} onToggleBlock={onToggleBlock} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RowActions({ row, busy, onToggleBlock }) {
  const [copied, setCopied] = useState(false)
  const url = profileUrl(row.id)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this URL', url)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link to={`/admin/keychain/${row.id}`} className="btn-primary !py-2 !text-xs">
        {row.assigned ? 'Edit' : 'Assign'}
      </Link>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary !py-2 !text-xs">
        View
      </a>
      <button type="button" className="btn-secondary !py-2 !text-xs" onClick={copy}>
        {copied ? 'Copied' : 'Copy URL'}
      </button>
      <button
        type="button"
        className={row.status === 'BLOCKED' ? 'btn-secondary !py-2 !text-xs' : 'btn-danger !py-2 !text-xs'}
        onClick={() => onToggleBlock(row)}
        disabled={busy}
      >
        {row.status === 'BLOCKED' ? 'Unblock' : 'Block'}
      </button>
    </div>
  )
}

function SeedButton({ onDone }) {
  const [busy, setBusy] = useState(false)

  async function run() {
    const answer = window.prompt(
      'Create keychain rows up to which ID?\n\nExisting rows are never touched — this only fills in missing IDs.',
      '500'
    )
    if (!answer) return
    const count = parseInt(answer, 10)
    if (!Number.isFinite(count) || count < 1) {
      window.alert('Enter a whole number, for example 500.')
      return
    }

    setBusy(true)
    try {
      const result = await seedKeychains(count)
      window.alert(`Added ${result.created} keychain rows. The sheet now holds ${result.total}.`)
      onDone()
    } catch (err) {
      window.alert(err.message || 'Could not create the rows.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="btn-secondary" onClick={run} disabled={busy}>
      {busy ? 'Working…' : 'Generate keychain IDs'}
    </button>
  )
}

function EmptyState({ hasFilters }) {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm font-medium text-slate-900">
        {hasFilters ? 'No keychains match that search.' : 'No keychains yet.'}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {hasFilters
          ? 'Try a different ID, name or hospital.'
          : 'Use “Generate keychain IDs” to create the rows for your printed batch.'}
      </p>
    </div>
  )
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
