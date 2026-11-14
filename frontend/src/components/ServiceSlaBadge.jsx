import { useEffect, useState } from 'react'
import { serviceSlaApi } from '../services/api.js'

/**
 * Sisa SLA layanan perluasan jaringan (TMP: 14/24/100 hari kerja sejak bayar) untuk sebuah permohonan, ditempatkan di tahap survei, gambar, KKO, KKF, MTO, dan SPK
 * agar petugas tahu sisa waktu pekerjaannya. Tersembunyi bila permohonan tidak punya SLA layanan atau pengguna tidak berhak melihatnya.
 */
const TONE = {
  NOT_STARTED: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  ON_TRACK: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60',
  DUE_SOON: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60',
  OVERDUE: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60',
  MET: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60',
  MET_LATE: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60',
}

export function slaBadgeText(sla) {
  if (!sla) return ''
  const due = sla.due_at ? new Date(sla.due_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
  switch (sla.status) {
    case 'NOT_STARTED': return `SLA TMP ${sla.working_days} hari kerja mulai setelah bayar`
    case 'OVERDUE': return `Melewati SLA TMP ${sla.late_working_days} hari kerja (tenggat ${due})`
    case 'MET': return 'SLA TMP terpenuhi'
    case 'MET_LATE': return `SLA TMP terlambat ${sla.late_working_days} hari kerja`
    default: return `SLA TMP ${sla.working_days} hari kerja: sisa ${sla.working_days_left ?? 0} hari kerja (tenggat ${due})`
  }
}

export default function ServiceSlaBadge({ applicationId, className = '' }) {
  const [sla, setSla] = useState(null)

  useEffect(() => {
    let live = true
    setSla(null)
    if (!applicationId) return undefined
    Promise.resolve()
      .then(() => serviceSlaApi.forApplication(applicationId))
      .then((r) => { if (live) setSla(r?.data || null) })
      .catch(() => { if (live) setSla(null) })
    return () => { live = false }
  }, [applicationId])

  if (!sla) return null
  return (
    <span role="status" data-testid="service-sla-badge" title={sla.category_label}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[sla.status] || TONE.ON_TRACK} ${className}`}>
      {slaBadgeText(sla)}
    </span>
  )
}
