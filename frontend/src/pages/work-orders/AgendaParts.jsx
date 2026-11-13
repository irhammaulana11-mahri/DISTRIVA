import StatusBadge from '../../components/StatusBadge.jsx'

export function ProgressBar({ percent, wide = false }) {
  const pct = Math.min(100, Math.max(0, Math.round(percent ?? 0)))
  return (
    <div className="flex items-center gap-2">
      <div className={`${wide ? 'w-28' : 'w-16'} bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden`}>
        <div className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-300'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300">{pct}%</span>
    </div>
  )
}

export function RevisionBadge({ number }) {
  if (!(number > 0)) return null
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">revisi {number}</span>
}

export function Fact({ label, children }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">{label}</div>
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{children || '-'}</div>
    </div>
  )
}

/** Ringkasan identitas agenda: dipakai di drawer pratinjau dan di halaman detail. */
export function AgendaFacts({ row }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
      <Fact label="No. Agenda">{row.agenda_number}</Fact>
      <Fact label="No. Permohonan"><span className="font-mono">{row.application_number}</span></Fact>
      <Fact label="Jenis">{row.application_type}</Fact>
      <Fact label="Pelanggan">{row.customer_name}</Fact>
      <Fact label="Unit">{row.unit_name}</Fact>
      <Fact label="Status permohonan">{row.application_status && <StatusBadge status={row.application_status} />}</Fact>
    </div>
  )
}

const OUTBOX = {
  PENDING: { label: 'Menunggu ekspor', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
  EXPORTED: { label: 'Sudah diekspor', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' },
  SENT: { label: 'Diserahkan', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
  CANCELLED: { label: 'Dibatalkan', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  SUPERSEDED: { label: 'Digantikan', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

const SENT_LABEL = { PARTIAL: 'Diserahkan sebagian', COMPLETE: 'Diserahkan lengkap' }

/** Status permintaan material (Outbox) sebuah agenda: status, kelengkapan penyerahan, material baru yang siap diserahkan, dan tanda bila perlu tindak lanjut. */
export function OutboxBadge({ request }) {
  if (!request) return null
  const o = OUTBOX[request.status] || { label: request.status, cls: 'bg-slate-100 text-slate-700' }
  const label = request.status === 'SENT' ? SENT_LABEL[request.fulfilment] || o.label : o.label
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${o.cls}`}>Outbox: {label}</span>
      {request.ready_to_send && request.status !== 'CANCELLED' && request.status !== 'SUPERSEDED' && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">Siap serah</span>}
      {request.needs_followup && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">Perlu tindak lanjut</span>}
    </span>
  )
}
