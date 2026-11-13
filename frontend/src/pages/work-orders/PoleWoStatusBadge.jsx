export const POLE_WO_STATUS = {
  DRAFT: { label: 'Draf', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  ISSUED: { label: 'Diterbitkan', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' },
  IN_PROGRESS: { label: 'Dikerjakan', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
  COMPLETED: { label: 'Selesai', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
  CANCELLED: { label: 'Dibatalkan', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300' },
}

export function PoleWoStatusBadge({ status }) {
  const s = POLE_WO_STATUS[status] || { label: status, cls: 'bg-slate-100 text-slate-700' }
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`}>{s.label}</span>
}
