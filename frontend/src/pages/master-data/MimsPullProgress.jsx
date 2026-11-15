import { warehouseOutcome } from './mimsOutcome'
import { useEffect, useState } from 'react'
import Spinner from '../../components/Spinner.jsx'

const STEP = { STOCK: 'stok fisik', ISSUES: 'pengeluaran', RESERVATIONS: 'reservasi', RECEIPTS: 'penerimaan' }

function duration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} mnt ${s % 60} dtk` : `${s} dtk`
}

/** Kemajuan penarikan MIMS yang sedang berjalan: gudang ke berapa, langkah yang dikerjakan, waktu berjalan, dan perkiraan sisa waktu. */
export default function MimsPullProgress({ run }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!run) return null
  const total = run.warehouses_total || 0
  const done = run.warehouses_done ?? (run.results || []).length
  const queued = run.status === 'QUEUED'
  const startedAt = run.started_at || run.created_at
  const elapsed = startedAt ? (now - new Date(startedAt).getTime()) / 1000 : 0
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const eta = done > 0 && total > done ? (elapsed / done) * (total - done) : null
  const rows = run.results || []
  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <Spinner size="sm" />
        <div className="min-w-0 flex-1">
          <div className="font-bold">{queued ? 'Penarikan menunggu giliran…' : 'Penarikan MIMS sedang berjalan'}</div>
          {!queued && (
            <div className="text-xs text-blue-700 dark:text-blue-300">
              {run.current_warehouse ? <>Sedang: <span className="font-semibold">{run.current_warehouse}</span>{run.current_step ? <> · menarik {STEP[run.current_step] || run.current_step}</> : null}</> : 'Menyiapkan penarikan…'}
            </div>
          )}
        </div>
      </div>
      {total > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs font-medium">
            <span>{done} dari {total} gudang selesai</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Kemajuan penarikan">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-700 dark:text-blue-300">
        <span>Berjalan: {duration(elapsed)}</span>
        {eta !== null && <span>Perkiraan sisa: ±{duration(eta)}</span>}
        <span>Halaman boleh ditutup; proses tetap berjalan di server.</span>
      </div>
      {rows.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
          {rows.map((r) => (
            <li key={r.warehouse_id} className="flex justify-between gap-3">
              <span className="truncate">{r.warehouse_code} · {r.warehouse_name}</span>
              <span className={['OK', 'SKIPPED'].includes(warehouseOutcome(r)) ? 'text-emerald-700 dark:text-emerald-300' : warehouseOutcome(r) === 'PARTIAL' ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}>{{ OK: 'Selesai', PARTIAL: 'Sebagian', FAILED: 'Gagal', SKIPPED: 'Dilewati' }[warehouseOutcome(r)]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
