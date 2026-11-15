import { useCallback, useEffect, useRef, useState } from 'react'
import Drawer from '../../components/Drawer.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import { connectionsApi } from '../../services/api.js'
import { IconRefresh, IconFolder, IconUpload, IconCheckCircle, IconAlertCircle } from '../../components/icons.jsx'

const fmtSize = (bytes) => {
  if (bytes == null) return '-'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2).toLocaleString('id-ID')} MB`
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('id-ID')} KB`
}
const fmtWhen = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}
const STATUS = {
  QUEUED: ['Menunggu', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'],
  RUNNING: ['Berjalan', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'],
  OK: ['Selesai', 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'],
  PARTIAL: ['Sebagian', 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'],
  FAILED: ['Gagal', 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'],
}
const isActive = (run) => run && (run.status === 'QUEUED' || run.status === 'RUNNING')

function Step({ n, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white" aria-hidden="true">{n}</span>
      <div className="min-w-0 text-sm text-slate-700 dark:text-slate-300">
        <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        <div className="mt-0.5 leading-relaxed">{children}</div>
      </div>
    </li>
  )
}

/** Sinkron DIL dari folder di server: cara meletakkan berkas, daftar berkas yang terdeteksi, tombol mulai, dan kemajuan. */
export default function DilSyncDrawer({ open, onClose, onFinished }) {
  const [info, setInfo] = useState(null)
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const finishedRef = useRef('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await connectionsApi.syncInfo()
      setInfo(r?.data || null)
      setRun((cur) => (isActive(r?.data?.active) ? r.data.active : cur && isActive(cur) ? cur : r?.data?.recent?.[0] || cur))
    } catch (err) {
      setError(err?.message || 'Gagal memuat info sinkron DIL.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  // Selama berjalan, kemajuan disegarkan tiap 3 detik; begitu selesai, daftar pelanggan dimuat ulang sekali.
  useEffect(() => {
    if (!open || !run?.id || !isActive(run)) return undefined
    const t = setInterval(async () => {
      try {
        const r = await connectionsApi.syncRun(run.id)
        setRun(r?.data || null)
        if (r?.data && !isActive(r.data)) { load() }
      } catch { /* dicoba lagi pada putaran berikutnya */ }
    }, 3000)
    return () => clearInterval(t)
  }, [open, run, load])

  useEffect(() => {
    if (run?.id && !isActive(run) && finishedRef.current !== run.id && run.results?.length) {
      finishedRef.current = run.id
      onFinished?.(run)
    }
  }, [run, onFinished])

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const r = await connectionsApi.syncStart()
      setRun(r?.data || null)
      finishedRef.current = ''
    } catch (err) {
      setError(err?.message || 'Sinkron DIL tidak dapat dimulai.')
    } finally {
      setStarting(false)
    }
  }

  const running = isActive(run)
  const files = info?.files || []
  const blockedByTools = Boolean(info?.needs_mdbtools && !info?.mdbtools)
  const canStart = files.length > 0 && !running && !blockedByTools && !starting
  const done = (run?.results || []).length
  const total = run?.files?.length || 0

  return (
    <Drawer open={open} onClose={onClose} title="Sinkron DIL" subtitle="Muat daftar pelanggan terbaru dari berkas DIL ke Master Pelanggan" size="max-w-2xl"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" icon={IconRefresh} onClick={load} loading={loading} disabled={running}>Periksa ulang folder</Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Tutup</Button>
            <Button icon={IconUpload} onClick={start} loading={starting} disabled={!canStart}>{running ? 'Sedang berjalan…' : 'Mulai sinkron'}</Button>
          </div>
        </div>
      )}>
      <div className="space-y-5">
        {error && <Alert variant="error">{error}</Alert>}

        <section aria-labelledby="dil-how" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-4">
          <h3 id="dil-how" className="text-sm font-bold text-slate-900 dark:text-slate-100">Cara meletakkan berkas</h3>
          <ol className="mt-3 space-y-3">
            <Step n={1} title="Siapkan berkas DIL">
              Unduhan DIL per ULP berformat <strong>.mdb</strong> (atau <strong>.csv</strong>). Nama contoh: <code className="rounded bg-white dark:bg-slate-900 px-1.5 py-0.5 text-xs">{info?.naming || 'DIL_SALDO_MASK_UP_202603_51453.mdb'}</code>. Kode ULP pada akhir nama dipakai untuk menandai berkas.
            </Step>
            <Step n={2} title="Salin ke folder di server">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 font-mono text-xs text-slate-800 dark:text-slate-200">
                <IconFolder className="h-3.5 w-3.5 text-emerald-600" /> {info?.inbox || 'backend/storage/app/dil-inbox'}
              </span>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Contoh: <code>cp DIL_SALDO_MASK_UP_202603_51453.mdb {info?.inbox || 'backend/storage/app/dil-inbox'}/</code>. Hanya folder ini yang dibaca; berkas selain .mdb dan .csv diabaikan. Boleh beberapa berkas sekaligus.</p>
            </Step>
            <Step n={3} title="Klik “Mulai sinkron”">
              Berkas yang terdeteksi tampil di bawah. Proses berjalan di latar belakang dan halaman ini boleh ditutup. Berkas yang selesai dimuat dipindah ke subfolder <code>diproses</code>.
            </Step>
          </ol>
          <p className="mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
            Aman diulang: IDPEL yang sama diperbarui, bukan digandakan. Nama pelanggan disamarkan, dan NIK, NPWP, telepon, email, alamat, serta koordinat tidak pernah dibaca.
          </p>
        </section>

        <section aria-labelledby="dil-files" className="space-y-2">
          <h3 id="dil-files" className="text-sm font-bold text-slate-900 dark:text-slate-100">Berkas di folder {info ? `(${files.length})` : ''}</h3>
          {blockedByTools && <Alert variant="warning">Berkas .mdb perlu mdbtools di server. Jalankan <code>sudo apt install mdbtools</code>, atau taruh berkas dalam bentuk .csv.</Alert>}
          {!info && loading ? <div className="flex justify-center py-6"><Spinner /></div> : files.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">Belum ada berkas. Salin berkas DIL ke folder di atas, lalu klik “Periksa ulang folder”.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full min-w-120 text-left text-xs">
                <caption className="sr-only">Berkas DIL di folder server</caption>
                <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr><th scope="col" className="px-3 py-2">Berkas</th><th scope="col" className="px-3 py-2">ULP</th><th scope="col" className="px-3 py-2">Periode</th><th scope="col" className="px-3 py-2 text-right">Ukuran</th><th scope="col" className="px-3 py-2">Diubah</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {files.map((f) => (
                    <tr key={f.name}>
                      <td className="px-3 py-2 font-mono break-all">{f.name}</td>
                      <td className="px-3 py-2">{f.ulp_code || '-'}</td>
                      <td className="px-3 py-2">{f.month ? `${f.month.slice(4)}/${f.month.slice(0, 4)}` : '-'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmtSize(f.size)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtWhen(f.modified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {run && (
          <section aria-labelledby="dil-run" className="space-y-2" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="dil-run" className="text-sm font-bold text-slate-900 dark:text-slate-100">{running ? 'Sedang berjalan' : 'Sinkron terakhir'}</h3>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${(STATUS[run.status] || STATUS.FAILED)[1]}`}>{(STATUS[run.status] || STATUS.FAILED)[0]}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {fmtWhen(run.started_at || run.created_at)} · oleh {run.started_by_name || '-'} · {Number(run.rows_done || 0).toLocaleString('id-ID')} baris diproses · {done} dari {total} berkas
              {running && run.current_file ? ` · membaca ${run.current_file}` : ''}
            </p>
            {running && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Berkas selesai">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${total ? Math.max(4, (done / total) * 100) : 4}%` }} />
              </div>
            )}
            {run.message && !running && <Alert variant={run.status === 'FAILED' ? 'error' : 'warning'}>{run.message}</Alert>}
            {(run.results || []).length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
                {run.results.map((r) => (
                  <li key={r.file} className="flex items-start gap-2 px-3 py-2">
                    {r.status === 'OK' ? <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                    <div className="min-w-0">
                      <p className="font-mono break-all text-slate-800 dark:text-slate-200">{r.file}</p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {r.status === 'OK'
                          ? `${Number(r.rows).toLocaleString('id-ID')} baris · baru ${Number(r.counts?.created || 0).toLocaleString('id-ID')} · diperbarui ${Number(r.counts?.updated || 0).toLocaleString('id-ID')} · tetap ${Number(r.counts?.unchanged || 0).toLocaleString('id-ID')} · tertaut gardu ${Number(r.counts?.gardu_linked || 0).toLocaleString('id-ID')} · belum tertaut ${Number(r.counts?.gardu_unlinked || 0).toLocaleString('id-ID')}${r.counts?.invalid ? ` · ditolak ${Number(r.counts.invalid).toLocaleString('id-ID')}` : ''}`
                          : r.message}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Drawer>
  )
}
