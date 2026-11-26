import { useEffect, useRef, useState } from 'react'
import { parseEisRun } from './eisRunResult.js'
import Spinner from '../../components/Spinner.jsx'
import { IconClipboard } from '../../components/icons.jsx'

const PILL = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  RUNNING: ['Berjalan', 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'],
  OK: ['Selesai', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'],
  FAILED: ['Gagal', 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'],
}
const nf = (n) => Number(n || 0).toLocaleString('id-ID')
const when = (v) => (v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-')

function duration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} mnt ${s % 60} dtk` : `${s} dtk`
}

function Kpi({ label, value, tone = 'text-slate-900 dark:text-slate-100', hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  )
}

/** Kemajuan dan hasil sinkronisasi EIS, disusun seperti hasil penarikan MIMS: kemajuan, kartu ringkasan, tabel per unit, log di bawahnya. */
export default function EisRunResults({ run, units }) {
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  const logRef = useRef(null)
  const live = ['QUEUED', 'RUNNING'].includes(run?.status)

  useEffect(() => {
    if (!live) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  useEffect(() => {
    if (run?.log && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [run?.log])

  if (!run) return null
  const r = parseEisRun(run.log, units, run.units || null, run.status)
  const startedAt = run.started_at || run.created_at
  const elapsed = startedAt ? (now - new Date(startedAt).getTime()) / 1000 : 0
  const percent = r.totalUnits > 0 ? Math.min(100, Math.round(((r.doneUnits + r.failedUnits) / r.totalUnits) * 100)) : 0
  const finished = r.doneUnits + r.failedUnits
  const eta = live && finished > 0 && r.totalUnits > finished ? (elapsed / finished) * (r.totalUnits - finished) : null
  const current = r.rows.find((x) => x.state === 'RUNNING')
  const copy = () => {
    navigator.clipboard?.writeText(run.log || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isPiutang = run?.kind === 'piutang'
  const isOnlyKontrol309 = isPiutang && Array.isArray(run?.options?.reports) && run.options.reports.length === 1 && run.options.reports[0] === 'KONTROL309'
  const isApkt = run?.kind === 'apkt'
  const isAp2t = run?.kind === 'ap2t'
  const isAp2tReports = Array.isArray(run?.options?.reports) ? run.options.reports : []
  const isAp2tPrrOnly = isAp2t && isAp2tReports.length > 0 && isAp2tReports.every((r) => r === 'pelunasan_prr' || r === 'pelunasan_ex_prr' || r === 'saldo_prr' || r === 'hapus_prr')
  const isAp2tBpOnly = isAp2t && isAp2tReports.length === 1 && isAp2tReports[0] === 'bp'
  const isRptRctGangguan = isApkt && run?.options?.dataset === 'rpt-rct-gangguan'
  const isRptRctKeluhan = isApkt && run?.options?.dataset === 'rpt-rct-keluhan'
  const isAnomaliGangguan = isApkt && run?.options?.dataset === 'anomali-gangguan'
  const isAnomaliKeluhan = isApkt && run?.options?.dataset === 'anomali-keluhan'
  const isTokenRejected = typeof run?.log === 'string' && run.log.toLowerCase().includes('token apkt ditolak')

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs" aria-label="Hasil sinkronisasi EIS">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Hasil Sinkronisasi EIS
            </h3>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              isApkt
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                : isAp2t
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                : isPiutang
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
            }`}>
              {isRptRctGangguan
                ? 'RPT/RCT Gangguan (APKT)'
                : isRptRctKeluhan
                ? 'RPT/RCT Keluhan (APKT)'
                : isAnomaliGangguan
                ? 'Anomali Gangguan (APKT)'
                : isAnomaliKeluhan
                ? 'Anomali Keluhan (APKT)'
                : isApkt
                ? 'SAIDI/SAIFI APKT (DIFI)'
                : isAp2t
                ? (isAp2tBpOnly ? 'Rekap BP (AP2T)' : isAp2tPrrOnly ? 'Pelunasan PRR (AP2T)' : 'TAGSUS P2TL (AP2T)')
                : isOnlyKontrol309
                ? 'Tarik Kontrol 309'
                : isPiutang
                ? 'Saldo Piutang'
                : 'Permohonan PB/PD'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {isRptRctGangguan
              ? 'Ringkasan penarikan durasi dan jumlah RPT/RCT WO gangguan langsung dari GraphQL APKT (tanpa dan dengan clear temper).'
              : isRptRctKeluhan
              ? 'Ringkasan penarikan durasi respons dan penyelesaian RPT/RCT WO keluhan langsung dari GraphQL APKT (satuan jam).'
              : isAnomaliGangguan
              ? 'Ringkasan penarikan anomali penanganan pengaduan gangguan (berulang dan rating negatif) langsung dari GraphQL APKT.'
              : isAnomaliKeluhan
              ? 'Ringkasan penarikan anomali penanganan pengaduan keluhan (berulang dan rating negatif) langsung dari GraphQL APKT.'
              : isApkt
              ? 'Ringkasan penarikan laporan SAIDI/SAIFI SE004 (DIFI) langsung dari GraphQL APKT per unit ULP.'
              : isAp2tBpOnly
              ? `Ringkasan penarikan rekap laporan biaya penyambungan (penerimaan, restitusi, peremajaan) langsung dari server AP2T per unit ULP.`
              : isAp2tPrrOnly
              ? `Ringkasan penarikan laporan pelunasan PRR dan Ex PRR langsung dari server AP2T per unit ULP${run?.options?.reports ? ` (Laporan: ${run.options.reports.map((x) => x === 'pelunasan_prr' ? 'Pelunasan PRR' : x === 'pelunasan_ex_prr' ? 'Pelunasan Ex PRR' : x === 'saldo_prr' ? 'Saldo PRR' : x === 'hapus_prr' ? 'Penghapusan PRR' : x === 'bp' ? 'Rekap BP' : x).join(', ')})` : ''}.`
              : isAp2t
              ? `Ringkasan penarikan laporan tagihan susulan P2TL langsung dari server AP2T per unit ULP${run?.options?.reports ? ` (Laporan: ${run.options.reports.map((x) => x === 'belum_realisasi' ? 'Belum realisasi' : x === 'realisasi' ? 'Realisasi' : x === 'pelunasan_prr' ? 'Pelunasan PRR' : x === 'pelunasan_ex_prr' ? 'Pelunasan Ex PRR' : x === 'saldo_prr' ? 'Saldo PRR' : x === 'hapus_prr' ? 'Penghapusan PRR' : x === 'bp' ? 'Rekap BP' : x).join(', ')})` : ''}.`
              : isOnlyKontrol309
              ? 'Ringkasan penarikan laporan Kontrol Penjualan 309 (309EIS) langsung dari server EIS per unit ULP.'
              : isPiutang
              ? 'Ringkasan penarikan laporan saldo piutang (Per Golongan, Per Lembar, Kogol) per unit ULP.'
              : 'Ringkasan status sinkronisasi permohonan per unit ULP.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${PILL[run.status]?.[1]}`}>{PILL[run.status]?.[0] || run.status}</span>
          <span className="text-[11px] text-slate-500">dimulai {when(startedAt)}</span>
        </div>
      </div>

      {isTokenRejected && (
        <div className="p-4 rounded-xl border border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-3">
          <div className="font-bold text-rose-600 dark:text-rose-400 shrink-0">⚠️</div>
          <div className="space-y-1">
            <div className="font-bold">Token APKT Ditolak atau Kedaluwarsa</div>
            <p className="text-[11px] leading-relaxed">
              APKT menolak token otorisasi yang digunakan (sesi berakhir atau token tidak valid). Silakan buka kembali APKT, salin nilai header <span className="font-mono font-semibold">Authorization</span> terbaru dari Network tab (F12), dan tempelkan ke kolom Token APKT untuk mengulang penarikan.
            </p>
          </div>
        </div>
      )}

      {live && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100" role="status">
          <div className="flex items-start gap-3">
            <Spinner size="sm" />
            <div className="min-w-0 flex-1">
              <div className="font-bold">{run.status === 'QUEUED' ? 'Sinkronisasi menunggu giliran…' : 'Sinkronisasi EIS sedang berjalan'}</div>
              <div className="text-xs text-blue-700 dark:text-blue-300">
                {current ? <>Sedang: <span className="font-semibold">{current.code} {current.name}</span> · mengunduh dan mengunggah</> : 'Menyiapkan sesi EIS…'}
              </div>
            </div>
          </div>
          {r.totalUnits > 0 && (
            <div>
              <div className="mb-1 flex justify-between text-xs font-medium">
                <span>{finished} dari {r.totalUnits} unit selesai</span>
                <span>{percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-700 dark:text-blue-300">
            <span>Berjalan: {duration(elapsed)}</span>
            {eta !== null && <span>Perkiraan sisa: ±{duration(eta)}</span>}
            <span>Halaman boleh ditutup; proses tetap berjalan di server.</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {r.perUnit && (
          <Kpi label="Unit diproses" value={<>{r.doneUnits} / {r.totalUnits} <span className="text-[11px] font-normal text-emerald-600">sukses</span></>}
            hint={r.failedUnits ? `${r.failedUnits} unit gagal` : undefined} tone={r.failedUnits ? 'text-rose-600' : undefined} />
        )}
        <Kpi label={isPiutang || isApkt ? 'Berkas baru' : 'Permohonan baru'} value={nf(r.baru)} tone="text-emerald-600" />
        <Kpi label={isPiutang || isApkt ? 'Berkas duplikat' : 'Cocok / diperbarui'} value={nf(r.cocok)} />
        <Kpi label="Ditolak" value={nf(r.ditolak)} tone={r.ditolak ? 'text-amber-600' : undefined} hint={r.luar ? `${nf(r.luar)} di luar cakupan` : undefined} />
      </div>

      {r.perUnit && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Unit</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Berkas</th>
                <th className="px-4 py-2.5 text-right">Baru</th>
                <th className="px-4 py-2.5 text-right">Cocok</th>
                <th className="px-4 py-2.5 text-right">Ditolak</th>
                <th className="px-4 py-2.5">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {r.rows.map((u) => (
                <tr key={u.code}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{u.name || u.code}</div>
                    <div className="font-mono text-[10px] text-slate-400">{u.code}</div>
                  </td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PILL[u.state][1]}`}>{PILL[u.state][0]}</span></td>
                  <td className="px-4 py-2.5 text-right font-mono">{u.state === 'QUEUED' ? '-' : u.files || '-'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-600">{u.state === 'QUEUED' ? '-' : nf(u.baru)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{u.state === 'QUEUED' ? '-' : nf(u.cocok)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-amber-600">{u.state === 'QUEUED' ? '-' : nf(u.ditolak)}</td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{u.message || (u.luar ? `${nf(u.luar)} di luar cakupan` : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {run.log && (
        <details className="group" open={live || undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold text-blue-600 dark:text-blue-400">
            <span>Lihat log lengkap</span>
            <button type="button" onClick={(e) => { e.preventDefault(); copy() }} className="inline-flex cursor-pointer items-center gap-1 hover:underline">
              <IconClipboard size={13} />
              <span>{copied ? 'Tersalin!' : 'Salin Log'}</span>
            </button>
          </summary>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 dark:border-slate-700">
            <pre ref={logRef} aria-label="Log sinkronisasi" className="max-h-64 select-all overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-slate-100">{run.log}</pre>
          </div>
        </details>
      )}
    </section>
  )
}
