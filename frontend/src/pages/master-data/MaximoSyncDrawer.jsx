import { useCallback, useEffect, useRef, useState } from 'react'
import { maximoSyncApi } from '../../services/api.js'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { IconRefresh, IconCheck, IconShieldCheck, IconEye, IconEyeOff } from '../../components/icons.jsx'

const inputCls =
  'block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all'

const STATUS = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  RUNNING: ['Berjalan', 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'],
  OK: ['Selesai', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'],
  FAILED: ['Gagal', 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'],
}

const when = (v) => (v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const dayText = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')
const live = (r) => r && ['QUEUED', 'RUNNING'].includes(r.status)

function Field({ label, hint, children }) {
  return (
    <label className="block text-xs">
      <span className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, STATUS.QUEUED[1]]
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{label}</span>
}

/** Ringkasan hasil satu sesi: daftar, dipilih, diambil, gagal, dan yang dimuat sebagai pembacaan. */
function SummaryText({ run }) {
  const s = run.summary
  if (!s) return <span className="text-slate-400">-</span>
  return (
    <span className="font-mono text-[11px]" data-testid="run-summary">
      {s.fetched ?? 0}/{s.chosen ?? 0} WO{s.failed ? <b className="text-rose-600"> · {s.failed} gagal</b> : ''}
      {s.load ? <span className="text-emerald-700 dark:text-emerald-400"> · {s.load.readings_stored} pembacaan baru</span> : ''}
    </span>
  )
}

/**
 * Sinkronisasi Maximo dari DISTRIVA: WO inspeksi gardu (INST1) yang selesai ditarik dari Maximo lalu dimuat sebagai pembacaan gardu
 * (beban dan tegangan per jurusan). Pengaturan akun dan jadwal harian, tombol sinkron manual, log sesi berjalan, dan riwayat sesi.
 */
export default function MaximoSyncDrawer({ open, onClose, onSynced }) {
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(null)
  const [runs, setRuns] = useState({ rows: [], meta: null })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [current, setCurrent] = useState(null)
  const [since, setSince] = useState('')
  const [allWo, setAllWo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [logRun, setLogRun] = useState(null)
  const timer = useRef(null)
  const logRef = useRef(null)

  const loadRuns = useCallback(async () => {
    try {
      const res = await maximoSyncApi.runs({ page, per_page: perPage })
      setRuns({ rows: res?.data || [], meta: res?.meta || null })
    } catch (err) {
      setError(err?.message || 'Gagal memuat riwayat sinkronisasi Maximo.')
    }
  }, [page, perPage])

  const load = useCallback(async () => {
    try {
      const res = await maximoSyncApi.show()
      const s = res?.data?.settings
      setSettings(s)
      setForm((f) => f || {
        maximo_url: s?.maximo_url || 'http://10.99.10.41',
        maximo_username: s?.maximo_username || '',
        maximo_password: '',
        work_type: s?.work_type || 'INST1',
        lookback_days: s?.lookback_days ?? 3,
        auto_enabled: Boolean(s?.auto_enabled),
        auto_time: s?.auto_time || '19:30',
      })
      const running = (res?.data?.runs || []).find(live)
      if (running) setCurrent((c) => c || running)
    } catch (err) {
      setError(err?.message || 'Gagal memuat pengaturan sinkronisasi Maximo.')
    }
  }, [])

  useEffect(() => {
    if (open) {
      setForm(null)
      setCurrent(null)
      setError('')
      setNotice('')
      setShowPassword(false)
      load()
    }
    return () => clearTimeout(timer.current)
  }, [open, load])

  useEffect(() => { if (open) loadRuns() }, [open, loadRuns])

  // Ikuti sesi yang sedang berjalan sampai selesai
  useEffect(() => {
    clearTimeout(timer.current)
    if (!open || !live(current)) return undefined
    timer.current = setTimeout(async () => {
      try {
        const res = await maximoSyncApi.run(current.id)
        setCurrent(res?.data)
        if (res?.data && !live(res.data)) {
          load()
          loadRuns()
          if (res.data.status === 'OK') onSynced?.()
        }
      } catch {
        setCurrent((c) => ({ ...c }))
      }
    }, 3000)
    return () => clearTimeout(timer.current)
  }, [open, current, load, loadRuns, onSynced])

  useEffect(() => {
    if (current?.log && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [current?.log])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await maximoSyncApi.save({ ...form, lookback_days: Number(form.lookback_days) })
      setSettings(res?.data)
      setForm((f) => ({ ...f, maximo_password: '' }))
      setNotice('Pengaturan disimpan.')
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan pengaturan.')
    } finally {
      setSaving(false)
    }
  }

  const start = async () => {
    setStarting(true)
    setError('')
    setNotice('')
    try {
      const body = {}
      if (since) body.since = since
      if (allWo) body.all_work_orders = true
      const res = await maximoSyncApi.start(body)
      setCurrent(res?.data)
      loadRuns()
    } catch (err) {
      setError(err?.message || 'Gagal memulai sinkronisasi.')
    } finally {
      setStarting(false)
    }
  }

  const openLog = async (r) => {
    setLogRun({ ...r, log: null })
    try {
      const res = await maximoSyncApi.run(r.id)
      setLogRun(res?.data)
    } catch (err) {
      setLogRun({ ...r, log: err?.message || 'Gagal memuat log.' })
    }
  }

  const running = live(current)
  const ready = Boolean(settings?.maximo_username && settings?.has_password)
  const lastRun = runs.rows[0] || null

  return (
    <PanelShell open={open} onClose={onClose} onBack={onClose} title="Sinkronisasi Maximo" subtitle="Tarik WO inspeksi gardu dari Maximo menjadi pembacaan beban dan tegangan per jurusan" size="max-w-3xl" width="max-w-3xl">
      {!form ? (
        <div className="py-16 text-center text-xs text-slate-500">
          <IconRefresh size={24} className="animate-spin mx-auto text-blue-600 mb-2" />
          <p>Memuat pengaturan dan riwayat sinkronisasi Maximo…</p>
        </div>
      ) : (
        <div className="space-y-6 text-xs" data-testid="maximo-sync">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Akun Maximo</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">{settings?.maximo_username || 'Belum diatur'}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{settings?.has_password ? 'Password aman tersimpan' : 'Password belum ada'}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Otomasi Harian</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">{settings?.auto_enabled ? `Pukul ${settings?.auto_time} WIB` : 'Nonaktif'}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{settings?.auto_enabled ? `WO selesai ${settings?.lookback_days} hari terakhir` : 'Manual saja'}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Riwayat</div>
              <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-1">{runs.meta?.total ?? runs.rows.length} Sesi</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Jenis pekerjaan {settings?.work_type}</div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Sesi Terakhir</div>
              <div className="text-sm font-bold mt-1">{lastRun ? <StatusBadge status={lastRun.status} /> : 'Belum ada'}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">{lastRun ? when(lastRun.created_at) : '-'}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200 dark:border-blue-900/60 shadow-xs">
            <div className="flex items-start gap-3">
              <IconShieldCheck size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold text-sm text-blue-950 dark:text-blue-100 flex items-center gap-2">
                  <span>Koneksi Aman & Perlindungan Kredensial Maximo</span>
                  {ready ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">Tersimpan & Terenkripsi</span>
                    : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">Kredensial Belum Lengkap</span>}
                </div>
                <p className="text-[11px] text-blue-700 dark:text-blue-300 max-w-3xl">Password akun Maximo dienkripsi pada database server dan tidak pernah dikirim kembali ke browser. Jangan memakai akun Maximo yang sama di browser selama sinkron berjalan.</p>
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setSettingsOpen(true)} className="cursor-pointer">Pengaturan</Button>
          </div>

          {!settingsOpen && error && <Alert kind="error">{error}</Alert>}
          {!settingsOpen && notice && <Alert kind="success">{notice}</Alert>}

          <section className="p-5 rounded-2xl border border-blue-200 dark:border-blue-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Tarik WO Inspeksi dari Maximo</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">WO berstatus COMP berjenis {settings?.work_type}; laporan tiap WO dibaca lalu dimuat sebagai pembacaan gardu yang sudah ada di master (gardu yang belum ada hanya dilaporkan).</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="WO selesai sejak tanggal (opsional)" hint={`Kosong = ${form.lookback_days} hari terakhir. Rentang panjang (mis. satu tahun) cukup ditarik sekali; penarikan berikutnya melewati WO yang sudah diambil.`}>
                <input aria-label="Sejak tanggal" type="date" value={since} onChange={(e) => setSince(e.target.value)} className={inputCls} />
              </Field>
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 cursor-pointer self-start">
                <input type="checkbox" checked={allWo} onChange={(e) => setAllWo(e.target.checked)} aria-label="Semua WO inspeksi" className="mt-0.5 rounded text-blue-600" />
                <span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Semua WO inspeksi</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Bawaan hanya WO terbaru per gardu. Centang untuk semua WO (lebih banyak dan lebih lama).</span>
                </span>
              </label>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <Button onClick={start} loading={starting} disabled={!ready || running} variant="primary" size="md" className="w-full sm:w-auto">
                <IconRefresh size={14} className={running ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                {running ? 'Sedang berjalan…' : 'Sinkronkan Sekarang'}
              </Button>
              {!ready && <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Simpan user dan password Maximo terlebih dulu.</span>}
            </div>
          </section>

          {current && (
            <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3" aria-label="Sesi berjalan">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Sesi {current.trigger === 'AUTO' ? 'otomatis' : 'manual'} · sejak {dayText(current.since)}</h4>
                <StatusBadge status={current.status} />
              </div>
              {current.summary && <div><SummaryText run={current} /></div>}
              <pre ref={logRef} aria-label="Log sinkronisasi" className="max-h-64 overflow-auto rounded-xl bg-slate-950 text-slate-100 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">{current.log || 'Menunggu proses dimulai…'}</pre>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Riwayat Sinkronisasi Maximo</h4>
            </div>
            {runs.rows.length === 0 ? (
              <p className="p-6 text-center text-slate-500">Belum ada sesi sinkronisasi.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                      <th className="py-3 px-4">Waktu</th>
                      <th className="py-3 px-4">Pemicu</th>
                      <th className="py-3 px-4">WO selesai sejak</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Hasil</th>
                      <th className="py-3 px-4 text-right">Log</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {runs.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200">{when(r.created_at)}</td>
                        <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">{r.trigger === 'AUTO' ? 'Otomatis' : 'Manual'}{r.all_work_orders && <span className="ml-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">semua WO</span>}</td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{dayText(r.since)}</td>
                        <td className="py-3 px-4"><StatusBadge status={r.status} /></td>
                        <td className="py-3 px-4"><SummaryText run={r} /></td>
                        <td className="py-3 px-4 text-right">
                          <button type="button" onClick={() => openLog(r)} aria-label={`Lihat log ${when(r.created_at)}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 transition cursor-pointer">
                            <IconEye size={12} /><span>Log</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {runs.meta && (
              <TableFooter itemCount={runs.rows.length} total={runs.meta.total} entityLabel="sesi" meta={runs.meta} page={page} perPage={perPage} onPage={setPage}
                onPerPage={(n) => { setPerPage(n); setPage(1) }} perPageOptions={[10, 25, 50]} />
            )}
          </section>

          <Modal open={Boolean(logRun)} onClose={() => setLogRun(null)} title="Log Sinkronisasi Maximo" subtitle={logRun ? `${when(logRun.created_at)} · ${STATUS[logRun.status]?.[0] || logRun.status}` : ''} size="max-w-3xl" width="max-w-3xl">
            <pre aria-label="Isi log" className="max-h-[60vh] overflow-auto rounded-xl bg-slate-950 text-slate-100 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">{logRun?.log ?? 'Memuat…'}</pre>
          </Modal>

          <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Pengaturan Sinkronisasi Maximo" subtitle="Akun Maximo, jenis pekerjaan, dan jadwal otomatis" size="max-w-3xl" width="max-w-3xl">
            <div className="space-y-5 text-xs">
              {error && <Alert kind="error">{error}</Alert>}
              {notice && <Alert kind="success">{notice}</Alert>}
              <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">Akun & parameter Maximo</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Field label="Alamat Maximo">
                    <input aria-label="Alamat Maximo" value={form.maximo_url} onChange={set('maximo_url')} placeholder="http://10.99.10.41" className={inputCls} />
                  </Field>
                  <Field label="Jenis pekerjaan (Work Type)" hint="INST1 = inspeksi berpengukuran. INST2 = tindak lanjut tanpa pengukuran.">
                    <input aria-label="Jenis pekerjaan" value={form.work_type} onChange={set('work_type')} className={`${inputCls} font-mono`} />
                  </Field>
                  <Field label="User Maximo">
                    <input aria-label="User Maximo" autoComplete="off" value={form.maximo_username} onChange={set('maximo_username')} className={inputCls} />
                  </Field>
                  <Field label="Password Maximo" hint={settings?.has_password ? 'Tersimpan terenkripsi; kosongkan untuk tetap memakainya.' : 'Disimpan terenkripsi dan tidak pernah ditampilkan lagi.'}>
                    <div className="relative">
                      <input aria-label="Password Maximo" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.maximo_password} onChange={set('maximo_password')}
                        placeholder={settings?.has_password ? '••••••••' : 'Masukkan password Maximo'} className={`${inputCls} pr-9`} />
                      <button type="button" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'} onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                        {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                      </button>
                    </div>
                  </Field>
                </div>
              </section>
              <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">Sinkronisasi otomatis</h4>
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 cursor-pointer">
                  <input type="checkbox" checked={form.auto_enabled} onChange={set('auto_enabled')} aria-label="Jalankan otomatis setiap hari" className="mt-0.5 rounded text-blue-600" />
                  <div className="space-y-0.5">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Jalankan otomatis setiap hari</span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Hanya menarik WO yang selesai dalam jendela hari di bawah; rentang panjang ditarik sekali secara manual.</p>
                  </div>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Field label="Jendela WO selesai (hari terakhir)" hint="Dipakai sinkron otomatis dan sinkron manual tanpa tanggal.">
                    <input aria-label="Jendela hari" type="number" min="1" max="365" value={form.lookback_days} onChange={set('lookback_days')} className={inputCls} />
                  </Field>
                  <Field label="Jam (WIB)" hint="Berjalan atas nama akun yang menyimpan pengaturan ini; butuh penjadwal server (`schedule:run`) aktif.">
                    <input aria-label="Jam sinkronisasi otomatis" type="time" value={form.auto_time} onChange={set('auto_time')} className={`${inputCls} max-w-44 font-mono font-bold`} />
                  </Field>
                </div>
                <div className="pt-2 flex justify-end">
                  <Button onClick={save} loading={saving} variant="primary" size="md"><IconCheck size={14} className="mr-1.5" />Simpan Pengaturan</Button>
                </div>
              </section>
            </div>
          </Modal>
        </div>
      )}
    </PanelShell>
  )
}
