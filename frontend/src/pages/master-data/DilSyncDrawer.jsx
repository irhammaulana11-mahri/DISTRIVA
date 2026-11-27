import { useCallback, useEffect, useMemo, useState } from 'react'
import Drawer from '../../components/Drawer.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import { connectionsApi } from '../../services/api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { SyncUp3Selector, SyncRunMetaBadges, SyncConflictAlert } from '../sync/SyncRunStatusHelpers.jsx'
import SyncTabLayout from '../sync/SyncTabLayout.jsx'
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
const duration = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} mnt ${s % 60} dtk` : `${s} dtk`
}
const month = (m) => (m && String(m).length === 6 ? `${String(m).slice(4)}/${String(m).slice(0, 4)}` : '-')
const n = (v) => Number(v || 0).toLocaleString('id-ID')

const CHIP = {
  OK: ['Berhasil', 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'],
  FAILED: ['Gagal', 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'],
  PARTIAL: ['Sebagian', 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'],
  RUNNING: ['Berjalan', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'],
  QUEUED: ['Menunggu', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'],
  NONE: ['Belum pernah', 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'],
}
const chip = (key) => {
  const [label, cls] = CHIP[key] || CHIP.NONE
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{label}</span>
}
const isActive = (run) => run && (run.status === 'QUEUED' || run.status === 'RUNNING')
const unitLabel = (u) => (u.name ? `${u.code} · ${u.name}` : u.code)

function Step({ n: num, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white" aria-hidden="true">{num}</span>
      <div className="min-w-0 text-sm text-slate-700 dark:text-slate-300">
        <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        <div className="mt-0.5 leading-relaxed">{children}</div>
      </div>
    </li>
  )
}

/** Kemajuan sinkron yang sedang berjalan, per ULP: ULP ke berapa, ULP yang sedang dibaca, waktu berjalan, dan perkiraan sisa. */
function Progress({ run }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const total = run.units_total || 0
  const done = run.units_done || 0
  const percent = run.bytes_total > 0 ? Math.min(100, Math.round(((run.bytes_done || 0) / run.bytes_total) * 100)) : (total ? Math.round((done / total) * 100) : 0)
  const started = run.started_at || run.created_at
  const elapsed = started ? (now - new Date(started).getTime()) / 1000 : 0
  const queued = run.status === 'QUEUED'
  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <Spinner size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{queued ? 'Sinkron menunggu giliran…' : 'Sinkron DIL sedang berjalan'}</p>
          {!queued && <p className="text-xs text-blue-700 dark:text-blue-300">{run.current_file ? <>Sedang membaca <span className="font-semibold">{run.current_file}</span></> : 'Menyiapkan…'}</p>}
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs font-medium"><span>{done} dari {total} ULP selesai</span><span>{percent}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Kemajuan sinkron">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(percent, 3)}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-700 dark:text-blue-300">
        <span>Berjalan: {duration(elapsed)}</span>
        {run.eta_seconds != null && <span>Perkiraan sisa: ±{duration(run.eta_seconds)}</span>}
        <span>{n(run.rows_done)} baris diproses</span>
        <span>Panel boleh ditutup; proses tetap berjalan di server.</span>
      </div>
      {(run.results || []).length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
          {run.results.map((r) => (
            <li key={r.file} className="flex justify-between gap-3">
              <span className="truncate">{r.unit_name ? `${r.ulp_code} · ${r.unit_name}` : (r.ulp_code || r.file)}</span>
              <span className={r.status === 'OK' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>{r.status === 'OK' ? `Berhasil · ${n(r.rows)} baris` : 'Gagal'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Sinkron DIL per ULP, seperti penarikan MIMS per gudang: pilih ULP, jalan berurutan, satu yang gagal tidak menghentikan yang lain, dan hasil tiap ULP dipantau. */
export default function DilSyncDrawer({ open = true, asPage = false, embedded = false, selectedUp3Id = '', onUp3Context, onClose, onFinished }) {
  const [info, setInfo] = useState(null)
  const [run, setRun] = useState(null)
  const [up3Id, setUp3Id] = useState(selectedUp3Id || '')
  const [up3s, setUp3s] = useState([])
  const [picked, setPicked] = useState(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [notified, setNotified] = useState('')

  const load = useCallback(async (overrideUp3Id) => {
    setLoading(true)
    setError('')
    try {
      const targetUp3 = overrideUp3Id !== undefined ? overrideUp3Id : up3Id
      const r = await connectionsApi.syncInfo(targetUp3 ? { up3_id: targetUp3 } : {})
      setInfo(r?.data || null)
      if (r?.data?.up3s) setUp3s(r.data.up3s)
      const resolvedUp3Id = r?.data?.up3_id || targetUp3 || ''
      if (r?.data?.up3_id) setUp3Id(r.data.up3_id)
      onUp3Context?.({ up3Id: resolvedUp3Id, up3s: r?.data?.up3s || [] })
      setRun((cur) => (isActive(r?.data?.active) ? r.data.active : cur && isActive(cur) ? cur : r?.data?.recent?.[0] || cur))
    } catch (err) {
      setError(err?.message || 'Gagal memuat info sinkron DIL.')
    } finally {
      setLoading(false)
    }
  }, [up3Id])

  useEffect(() => {
    if (selectedUp3Id && selectedUp3Id !== up3Id) {
      setUp3Id(selectedUp3Id)
      setRun(null)
      setPicked(null)
      setConflict(null)
      load(selectedUp3Id)
    }
  }, [selectedUp3Id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) load() }, [open, load])

  // Selama berjalan, kemajuan disegarkan tiap 3 detik; begitu selesai, info dan daftar pelanggan dimuat ulang sekali.
  useEffect(() => {
    if (!open || !run?.id || !isActive(run)) return undefined
    const t = setInterval(async () => {
      try {
        const r = await connectionsApi.syncRun(run.id)
        setRun(r?.data || null)
        if (r?.data && !isActive(r.data)) load()
      } catch { /* dicoba lagi pada putaran berikutnya */ }
    }, 3000)
    return () => clearInterval(t)
  }, [open, run, load])

  useEffect(() => {
    if (run?.id && !isActive(run) && notified !== run.id && run.results?.length) {
      setNotified(run.id)
      onFinished?.(run)
    }
  }, [run, notified, onFinished])

  const units = useMemo(() => info?.units || [], [info])
  const withFile = useMemo(() => units.filter((u) => u.files?.length > 0), [units])
  const selected = picked ?? withFile.map((u) => u.code)
  const running = isActive(run)
  const blockedByTools = Boolean(info?.needs_mdbtools && !info?.mdbtools)
  const failedCodes = useMemo(() => units.filter((u) => u.files?.length > 0 && u.last_result?.status && u.last_result.status !== 'OK').map((u) => u.code), [units])
  const canStart = selected.length > 0 && !running && !blockedByTools && !starting
  const toggle = (code) => setPicked(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])

  const start = async () => {
    setStarting(true)
    setError('')
    setConflict(null)
    try {
      const r = await connectionsApi.syncStart({ units: selected, ...(up3Id ? { up3_id: up3Id } : {}) })
      setRun(r?.data || null)
      setPicked(null)
    } catch (err) {
      if (err?.status === 409 && err?.data) {
        setConflict(err.data)
        if (err.data.active_run_id) {
          connectionsApi.syncRun(err.data.active_run_id).then((res) => {
            if (res?.data) setRun(res.data)
          }).catch(() => {})
        }
      }
      setError(err?.message || 'Sinkron DIL tidak dapat dimulai.')
    } finally {
      setStarting(false)
    }
  }

  const mon = info?.monitor
  const history = info?.history || []

  const footerActions = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="secondary" icon={IconRefresh} onClick={load} loading={loading} disabled={running}>Periksa ulang folder</Button>
      <div className="flex items-center gap-2">
        {!asPage && <Button variant="secondary" onClick={onClose}>Tutup</Button>}
        <Button icon={IconUpload} onClick={start} loading={starting} disabled={!canStart}>{running ? 'Sedang berjalan…' : `Mulai sinkron (${selected.length} ULP)`}</Button>
      </div>
    </div>
  )

  const body = (
    <div className="space-y-5">
        {!embedded && (
          <SyncUp3Selector
            up3Id={up3Id}
            up3s={up3s}
            onChange={(nextId) => {
              setUp3Id(nextId)
              setRun(null)
              setPicked(null)
              setConflict(null)
              load(nextId)
            }}
          />
        )}
        <SyncConflictAlert conflict={conflict} onDismiss={() => setConflict(null)} />
        {error && <Alert variant="error">{error}</Alert>}

        {running && run && <SyncRunMetaBadges run={run} />}
        {running && run && <Progress run={run} />}

        <details className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-4" open={withFile.length === 0}>
          <summary className="cursor-pointer text-sm font-bold text-slate-900 dark:text-slate-100">Cara meletakkan berkas</summary>
          <ol className="mt-3 space-y-3">
            <Step n={1} title="Siapkan berkas DIL">
              Unduhan DIL per ULP berformat <strong>.mdb</strong> (atau <strong>.csv</strong>). Nama contoh: <code className="rounded bg-white dark:bg-slate-900 px-1.5 py-0.5 text-xs">{info?.naming || 'DIL_SALDO_MASK_UP_202609_51453.mdb'}</code>. Kode ULP 5 digit di akhir nama menentukan ULP mana yang dimuat.
            </Step>
            <Step n={2} title="Salin ke folder di server">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 font-mono text-xs text-slate-800 dark:text-slate-200">
                <IconFolder className="h-3.5 w-3.5 text-emerald-600" /> {info?.inbox || 'backend/storage/app/dil-inbox'}
              </span>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Contoh: <code>cp DIL_SALDO_MASK_UP_202609_51453.mdb {info?.inbox || 'backend/storage/app/dil-inbox'}/</code>. Hanya folder ini yang dibaca; berkas selain .mdb dan .csv diabaikan.</p>
            </Step>
            <Step n={3} title="Pilih ULP lalu klik “Mulai sinkron”">
              ULP dimuat satu per satu berurutan. Satu ULP yang gagal tidak menghentikan yang lain, dan berkasnya tetap di folder untuk diulang. Berkas yang berhasil dipindah ke subfolder <code>diproses</code>.
            </Step>
          </ol>
          <p className="mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
            Aman diulang: IDPEL yang sama diperbarui, bukan digandakan. Nama pelanggan disamarkan, dan NIK, NPWP, telepon, email, alamat, serta koordinat tidak pernah dibaca.
          </p>
        </details>

        {mon && (
          <section aria-label="Ringkasan hasil sinkron" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['ULP', mon.units_total, 'text-slate-900 dark:text-slate-100'], ['Berhasil', mon.units_ok, 'text-emerald-600 dark:text-emerald-400'], ['Gagal', mon.units_failed, 'text-rose-600 dark:text-rose-400'], ['Belum pernah', mon.units_never, 'text-slate-500 dark:text-slate-400']].map(([label, v, cls]) => (
              <div key={label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
                <p className={`mt-0.5 text-2xl font-bold ${cls}`}>{n(v)}</p>
              </div>
            ))}
          </section>
        )}

        <section aria-labelledby="dil-units" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="dil-units" className="text-sm font-bold text-slate-900 dark:text-slate-100">Pilih ULP yang disinkronkan {info ? `(${selected.length} dari ${withFile.length} berkas siap)` : ''}</h3>
            <div className="flex gap-3 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <button type="button" className="cursor-pointer hover:underline" onClick={() => setPicked(withFile.map((u) => u.code))}>Pilih semua</button>
              <button type="button" className="cursor-pointer hover:underline" onClick={() => setPicked([])}>Kosongkan</button>
              {failedCodes.length > 0 && <button type="button" className="cursor-pointer hover:underline" onClick={() => setPicked(failedCodes)}>Pilih yang gagal ({failedCodes.length})</button>}
            </div>
          </div>
          {blockedByTools && <Alert variant="warning">Berkas .mdb perlu mdbtools di server. Jalankan <code>sudo apt install mdbtools</code>, atau taruh berkas dalam bentuk .csv.</Alert>}
          {!info && loading ? <div className="flex justify-center py-6"><Spinner /></div> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full min-w-160 text-left text-xs">
                <caption className="sr-only">ULP, berkas di folder, dan hasil sinkron terakhir</caption>
                <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr><th scope="col" className="px-3 py-2 w-8"><span className="sr-only">Pilih</span></th><th scope="col" className="px-3 py-2">ULP</th><th scope="col" className="px-3 py-2">Berkas di folder</th><th scope="col" className="px-3 py-2 text-right">Pelanggan</th><th scope="col" className="px-3 py-2">Data</th><th scope="col" className="px-3 py-2">Hasil terakhir</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {units.map((u) => {
                    const f = u.files?.[0]
                    const last = u.last_result
                    return (
                      <tr key={u.code} className={f ? '' : 'text-slate-400 dark:text-slate-500'}>
                        <td className="px-3 py-2"><input type="checkbox" aria-label={`Sinkronkan ${unitLabel(u)}`} disabled={!f || running} checked={Boolean(f) && selected.includes(u.code)} onChange={() => toggle(u.code)} /></td>
                        <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{unitLabel(u)}</td>
                        <td className="px-3 py-2">{f ? <><span className="font-mono break-all">{f.name}</span><span className="ml-1 text-slate-500">· {fmtSize(f.size)}</span></> : 'tidak ada berkas'}</td>
                        <td className="px-3 py-2 text-right">{n(u.customers)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{month(u.snapshot_month)}</td>
                        <td className="px-3 py-2">
                          {chip(last?.status || 'NONE')}
                          {last && <span className="mt-0.5 block text-[10px] text-slate-500">{fmtWhen(last.at)}{last.status === 'OK' ? ` · ${n(last.rows)} baris` : ''}</span>}
                          {last?.status && last.status !== 'OK' && last.message && <span className="block text-[10px] text-rose-600 dark:text-rose-400">{last.message}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(info?.unrecognised_files || []).length > 0 && <Alert variant="warning">{`Berkas tanpa kode ULP 5 digit di akhir namanya diabaikan: ${info.unrecognised_files.map((f) => f.name).join(', ')}.`}</Alert>}
        </section>

        <section aria-labelledby="dil-history" className="space-y-2">
          <h3 id="dil-history" className="text-sm font-bold text-slate-900 dark:text-slate-100">Monitoring: riwayat sinkron</h3>
          {history.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">Belum ada sinkron yang dijalankan.</p> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
              {history.map((h) => (
                <li key={h.id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {chip(h.status)}
                      <span className="font-medium text-slate-800 dark:text-slate-200">{fmtWhen(h.started_at)}</span>
                      <span className="text-slate-500">oleh {h.started_by_name || '-'}</span>
                    </div>
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <IconCheckCircle className="h-3.5 w-3.5 text-emerald-600" /> {h.units_ok} berhasil
                      <IconAlertCircle className={`ml-1 h-3.5 w-3.5 ${h.units_failed ? 'text-rose-600' : 'text-slate-300'}`} /> {h.units_failed} gagal
                      <span className="ml-1 text-slate-400">· {n(h.rows)} baris{h.seconds != null ? ` · ${duration(h.seconds)}` : ''}</span>
                    </span>
                  </div>
                  {h.failed?.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 pl-1 text-rose-700 dark:text-rose-300">
                      {h.failed.map((f) => <li key={f.file}>{f.unit_name ? `${f.ulp_code} · ${f.unit_name}` : (f.ulp_code || f.file)}: {f.message || 'gagal'}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {run && !running && (run.results || []).length > 0 && (
          <section aria-labelledby="dil-last" className="space-y-2">
            <h3 id="dil-last" className="text-sm font-bold text-slate-900 dark:text-slate-100">Rincian sinkron terakhir</h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
              {run.results.map((r) => (
                <li key={r.file} className="flex items-start gap-2 px-3 py-2">
                  {r.status === 'OK' ? <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{r.unit_name ? `${r.ulp_code} · ${r.unit_name}` : (r.ulp_code || '-')} <span className="font-mono font-normal text-slate-500 break-all">{r.file}</span></p>
                    <p className="text-slate-500 dark:text-slate-400">
                      {r.status === 'OK'
                        ? `${n(r.rows)} baris · baru ${n(r.counts?.created)} · diperbarui ${n(r.counts?.updated)} · tetap ${n(r.counts?.unchanged)} · tertaut gardu ${n(r.counts?.gardu_linked)} · belum tertaut ${n(r.counts?.gardu_unlinked)}${r.counts?.invalid ? ` · ditolak ${n(r.counts.invalid)}` : ''}${r.seconds != null ? ` · ${duration(r.seconds)}` : ''}`
                        : r.message}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
    </div>
  )

  if (asPage && embedded) {
    const dilStats = [
      { label: 'Unit DIL', value: `${units.length} ULP`, sub: 'Terdaftar di folder inbox' },
      { label: 'Berkas Siap', value: `${withFile.length} ULP`, sub: 'Berkas .mdb / .csv ditemukan' },
      { label: 'Dipilih', value: `${selected.length} ULP`, sub: `Dari ${withFile.length} ULP siap` },
      { label: 'Sesi Terakhir', value: run ? <StatusBadge status={run.status} /> : 'Belum ada', sub: run?.created_at ? String(run.created_at).slice(0, 16).replace('T', ' ') : '-' },
    ]
    return (
      <SyncTabLayout
        stats={dilStats}
        banner={{
          title: 'Sinkronisasi DIL Pelanggan per ULP',
          badge: `${withFile.length} ULP siap`,
          badgeTone: withFile.length > 0 ? 'ok' : 'warn',
          desc: 'Muat daftar pelanggan terbaru per ULP dari berkas DIL (.mdb / .csv) di folder inbox server.',
          actionLabel: 'Periksa ulang folder',
          actionIcon: IconRefresh,
          actionLoading: loading,
          actionDisabled: running,
          onAction: load,
        }}
        alerts={
          <>
            <SyncConflictAlert conflict={conflict} onDismiss={() => setConflict(null)} />
            {error && <Alert variant="error">{error}</Alert>}
          </>
        }
      >
        {running && run && <SyncRunMetaBadges run={run} />}
        {running && run && <Progress run={run} />}
        <section className="p-5 rounded-2xl border border-blue-200 dark:border-blue-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Tarik Data DIL Pelanggan per ULP</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Eksekusi pemuatan daftar pelanggan (.mdb / .csv) dari folder inbox server.</p>
            </div>
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
              Inbox Server
            </span>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
            <div className="font-semibold text-slate-800 dark:text-slate-200">Cakupan Data yang Ditarik:</div>
            <p>
              Berkas DIL dibaca per ULP secara berurutan; satu ULP yang gagal tidak menghentikan ULP lainnya.
            </p>
          </div>
          {body}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <Button icon={IconUpload} onClick={start} loading={starting} disabled={!canStart} variant="primary" size="md" className="w-full sm:w-auto">
              {running ? 'Sedang berjalan…' : `Mulai sinkron (${selected.length} ULP)`}
            </Button>
            {withFile.length === 0 && (
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Belum ada berkas DIL siap di folder inbox untuk unit terpilih.
              </span>
            )}
          </div>
        </section>
      </SyncTabLayout>
    )
  }

  if (asPage) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5 shadow-xs">
        <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Sinkron DIL Pelanggan</h2>
          <p className="text-xs text-slate-500">Muat daftar pelanggan terbaru per ULP dari berkas DIL (.mdb / .csv).</p>
        </div>
        {body}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">{footerActions}</div>
      </div>
    )
  }

  return (
    <Drawer open={open} onClose={onClose} title="Sinkron DIL" subtitle="Muat daftar pelanggan terbaru per ULP dari berkas DIL" size="max-w-3xl" footer={footerActions}>
      {body}
    </Drawer>
  )
}
