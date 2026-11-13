const styles = {
  error: 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200',
  success: 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200',
  warning: 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200',
  info: 'border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200',
}

const badgeStyles = {
  error: 'bg-red-600 text-white',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-600 text-white',
  info: 'bg-blue-600 text-white',
}

const badgeLabels = {
  error: 'GAGAL',
  success: 'BERHASIL',
  warning: 'PERINGATAN',
  info: 'INFO',
}

export default function Alert({ kind, variant, children, className = '' }) {
  const rawKind = kind || variant || 'error'
  const resolvedKind = rawKind === 'danger' ? 'error' : rawKind
  const styleClass = styles[resolvedKind] ?? styles.error
  const badgeClass = badgeStyles[resolvedKind] ?? badgeStyles.error
  const badgeLabel = badgeLabels[resolvedKind] ?? badgeLabels.error

  return (
    <div
      role={resolvedKind === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-3.5 py-2.5 text-sm flex items-start gap-2.5 ${styleClass} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${badgeClass}`}
      >
        {badgeLabel}
      </span>
      <div className="flex-1 min-w-0 leading-relaxed">{children}</div>
    </div>
  )
}
