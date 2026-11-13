const tone = {
  ACTIVE: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  PENDING_ACTIVATION: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60',
  SUSPENDED: 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
  INACTIVE: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  PENDING_BACKEND: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60',
  // Distriva / EIS Lifecycle Statuses
  DRAFT: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  SUBMITTED: 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60',
  APPROVED: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  DISETUJUI: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  PAID: 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border-teal-200/80 dark:border-teal-800/60',
  BAYAR: 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border-teal-200/80 dark:border-teal-800/60',
  'SUDAH BAYAR': 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 border-teal-200/80 dark:border-teal-800/60',
  PK_PRINTED: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60',
  'CETAK PK': 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60',
  CONNECTION_IN_PROGRESS: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60',
  'PDL AWAL': 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60',
  CONNECTION_DONE: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  PEREMAJAAN: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  CANCELLED: 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
  BATAL: 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
  REFUNDED: 'bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/60',
  RESTITUSI: 'bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/60',
  UNDER_REVIEW: 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-800 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/60',
  ACCEPTED: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  RETURNED: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60',
  SUPERSEDED: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  VERIFIED: 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-800 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/60',
  REJECTED: 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
  IN_PROGRESS: 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-800 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/60',
  COMPLETED: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  COMPLETED_NO_EXTENSION: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  OPEN: 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60',
  // Backup / Restore Statuses
  RUNNING: 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60',
  SUCCEEDED: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  FAILED: 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
  DELETED: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  // Kelayakan (KKF / KKO)
  LAYAK: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60',
  TIDAK_LAYAK: 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
  'TIDAK LAYAK': 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
}

const dotColor = {
  ACTIVE: 'bg-emerald-500',
  PENDING_ACTIVATION: 'bg-amber-500',
  SUSPENDED: 'bg-rose-500',
  INACTIVE: 'bg-slate-400',
  PENDING_BACKEND: 'bg-amber-500',
  DRAFT: 'bg-slate-400',
  SUBMITTED: 'bg-blue-500',
  APPROVED: 'bg-emerald-500',
  DISETUJUI: 'bg-emerald-500',
  PAID: 'bg-teal-500',
  BAYAR: 'bg-teal-500',
  'SUDAH BAYAR': 'bg-teal-500',
  PK_PRINTED: 'bg-indigo-500',
  'CETAK PK': 'bg-indigo-500',
  CONNECTION_IN_PROGRESS: 'bg-amber-500',
  'PDL AWAL': 'bg-amber-500',
  CONNECTION_DONE: 'bg-emerald-500',
  PEREMAJAAN: 'bg-emerald-500',
  CANCELLED: 'bg-rose-500',
  BATAL: 'bg-rose-500',
  REFUNDED: 'bg-purple-500',
  RESTITUSI: 'bg-purple-500',
  UNDER_REVIEW: 'bg-cyan-500',
  ACCEPTED: 'bg-emerald-500',
  RETURNED: 'bg-amber-500',
  SUPERSEDED: 'bg-slate-400',
  VERIFIED: 'bg-cyan-500',
  REJECTED: 'bg-rose-500',
  IN_PROGRESS: 'bg-cyan-500',
  COMPLETED: 'bg-emerald-500',
  COMPLETED_NO_EXTENSION: 'bg-emerald-500',
  OPEN: 'bg-blue-500',
  RUNNING: 'bg-blue-500',
  SUCCEEDED: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  DELETED: 'bg-slate-400',
  LAYAK: 'bg-emerald-500',
  TIDAK_LAYAK: 'bg-rose-500',
  'TIDAK LAYAK': 'bg-rose-500',
}

const label = {
  ACTIVE: 'Aktif',
  PENDING_ACTIVATION: 'Menunggu aktivasi',
  SUSPENDED: 'Ditangguhkan',
  INACTIVE: 'Nonaktif',
  PENDING_BACKEND: 'Menunggu Backend',
  DRAFT: 'Draf',
  SUBMITTED: 'Diajukan',
  APPROVED: 'Disetujui',
  DISETUJUI: 'Disetujui',
  PAID: 'Bayar',
  BAYAR: 'Bayar',
  'SUDAH BAYAR': 'Bayar',
  PK_PRINTED: 'Cetak PK',
  'CETAK PK': 'Cetak PK',
  CONNECTION_IN_PROGRESS: 'PDL Awal',
  'PDL AWAL': 'PDL Awal',
  CONNECTION_DONE: 'Peremajaan',
  PEREMAJAAN: 'Peremajaan',
  CANCELLED: 'Batal',
  BATAL: 'Batal',
  REFUNDED: 'Restitusi',
  RESTITUSI: 'Restitusi',
  UNDER_REVIEW: 'Dalam Review',
  ACCEPTED: 'Diterima',
  RETURNED: 'Dikembalikan',
  SUPERSEDED: 'Digantikan',
  VERIFIED: 'Terverifikasi',
  REJECTED: 'Ditolak',
  IN_PROGRESS: 'Dalam Proses',
  COMPLETED: 'Selesai',
  COMPLETED_NO_EXTENSION: 'Selesai tanpa perluasan',
  OPEN: 'Aktif / Terbuka',
  RUNNING: 'Berjalan',
  SUCCEEDED: 'Berhasil',
  FAILED: 'Gagal',
  DELETED: 'Dihapus',
  LAYAK: 'Layak',
  TIDAK_LAYAK: 'Tidak Layak',
  'TIDAK LAYAK': 'Tidak Layak',
}

export function formatStatusLabel(status) {
  if (!status) return '-'
  const key = String(status).trim().toUpperCase()
  return label[key] ?? label[status] ?? status
}

export function VerifiedBadge({ passed = true, date = null }) {
  if (!passed) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-tight border bg-cyan-50 dark:bg-cyan-950/50 text-cyan-800 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/60"
      title={date ? `Terverifikasi pada: ${new Date(date).toLocaleString('id-ID')}` : 'Terverifikasi'}
    >
      <span className="text-cyan-600 dark:text-cyan-400">✓</span>
      <span>Terverifikasi</span>
    </span>
  )
}

export default function StatusBadge({ status }) {
  const key = status ? String(status).trim().toUpperCase() : ''
  const dot = dotColor[key] ?? dotColor[status] ?? dotColor.INACTIVE
  const isPulse =
    key === 'ACTIVE' ||
    key === 'IN_PROGRESS' ||
    key === 'CONNECTION_IN_PROGRESS' ||
    key === 'PDL AWAL' ||
    key === 'UNDER_REVIEW' ||
    key === 'RUNNING'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight shadow-2xs ${
        tone[key] ?? tone[status] ?? tone.INACTIVE
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${isPulse ? 'animate-pulse' : ''}`} />
      <span>{label[key] ?? label[status] ?? status}</span>
    </span>
  )
}
