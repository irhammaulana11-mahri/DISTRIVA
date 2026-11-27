import StatusBadge from '../../components/StatusBadge.jsx'

export function formatRunStateLabel(run) {
  if (!run) return ''
  const state = run.state || run.status
  if (state === 'QUEUED') {
    return run.queue_position ? `Antre (#${run.queue_position})` : 'Antre'
  }
  if (state === 'RUNNING') return 'Berjalan'
  if (state === 'SUCCEEDED' || state === 'OK') return 'Selesai'
  if (state === 'PARTIAL') return 'Sebagian'
  if (state === 'FAILED') return 'Gagal'
  return state
}

export function SyncUp3Selector({ up3Id, up3s = [], onChange, disabled = false, label = 'Unit Induk / UP3' }) {
  if (!Array.isArray(up3s) || up3s.length === 0) return null
  if (up3s.length === 1) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-200">
        <span className="text-slate-400">{label}:</span>
        <span className="font-semibold">{up3s[0].name}</span>
      </div>
    )
  }
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
      <span className="font-medium shrink-0">{label}:</span>
      <select
        aria-label={label}
        value={up3Id || up3s[0]?.id || ''}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {up3s.map((u) => (
          <option key={u.id} value={u.id}>
            {u.code ? `${u.code} - ` : ''}{u.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SyncRunMetaBadges({ run }) {
  if (!run) return null
  const state = run.state || run.status
  const stateLabel = formatRunStateLabel(run)
  const stateCls =
    state === 'RUNNING'
      ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
      : state === 'QUEUED'
      ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
      : state === 'SUCCEEDED' || state === 'OK'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
      : state === 'FAILED'
      ? 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
      : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  const progress = run.progress
  const hasProgress = progress && progress.total_units !== null && progress.total_units !== undefined

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold ${stateCls}`}>
        {stateLabel}
      </span>
      {run.up3?.name && (
        <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium text-slate-700 dark:text-slate-200">
          {run.up3.name}
        </span>
      )}
      {run.scope?.name && (
        <span className="rounded bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-indigo-700 dark:text-indigo-300 font-medium">
          Cakupan: {run.scope.name}
        </span>
      )}
      {run.account?.name && (
        <span className="rounded bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-emerald-700 dark:text-emerald-300 font-medium">
          Akun: {run.account.name}
        </span>
      )}
      {run.triggered_by?.name && (
        <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-slate-600 dark:text-slate-300">
          Pemicu: {run.triggered_by.name}
        </span>
      )}
      {hasProgress && (
        <span className="rounded bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 font-mono font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
          {progress.done_units ?? 0}/{progress.total_units}
        </span>
      )}
    </div>
  )
}

export function SyncConflictAlert({ conflict, onDismiss }) {
  if (!conflict) return null
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1.5"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{conflict.message || 'Sinkronisasi untuk sasaran ini sedang berlangsung.'}</p>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="text-[11px] underline shrink-0 cursor-pointer">
            Tutup
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-amber-800 dark:text-amber-300">
        {conflict.triggered_by?.name && (
          <span>Dipicu oleh: <strong>{conflict.triggered_by.name}</strong></span>
        )}
        {conflict.scope?.name && (
          <span>Tingkat run aktif: <strong>{conflict.scope.type || ''} {conflict.scope.name}</strong></span>
        )}
        {conflict.active_run_id && (
          <span className="font-mono">Run ID: {conflict.active_run_id}</span>
        )}
      </div>
      {Array.isArray(conflict.conflicts) && conflict.conflicts.length > 0 && (
        <div className="pt-1">
          <span className="text-[11px] font-medium">Sasaran yang bentrok: </span>
          <span className="text-[11px]">{conflict.conflicts.map((c) => c.name || c.id).join(', ')}</span>
        </div>
      )}
    </div>
  )
}
