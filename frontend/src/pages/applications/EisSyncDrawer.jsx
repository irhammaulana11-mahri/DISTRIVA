import { useCallback, useEffect, useRef, useState } from 'react'
import { eisSyncApi } from '../../services/api.js'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'

const inputCls = 'block w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'
const STATUS = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700'],
  RUNNING: ['Berjalan', 'bg-blue-100 text-blue-800'],
  OK: ['Selesai', 'bg-emerald-100 text-emerald-800'],
  FAILED: ['Gagal', 'bg-rose-100 text-rose-800'],
}
const when = (v) => (v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-')

function Field({ label, hint, children }) {
  return (
    <label className="block text-xs">
      <span className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  )
}

/** Sinkronisasi EIS dari DISTRIVA: akun EIS, rentang daya, jadwal otomatis, tombol sinkronkan, dan riwayat. */
export default function EisSyncDrawer({ open, asPage = false, onClose, onSynced }) {
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(null)
  const [runs, setRuns] = useState([])
  const [current, setCurrent] = useState(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const timer = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await eisSyncApi.show()
      const s = res?.data?.settings
      setSettings(s)
      setForm((f) => f || { eis_username: s?.eis_username || '', eis_password: '', power_min: s?.power_min ?? 0, power_max: s?.power_max ?? 99999999, lookback_days: s?.lookback_days ?? 180, auto_enabled: Boolean(s?.auto_enabled), auto_time: s?.auto_time || '18:13' })
      setRuns(res?.data?.runs || [])
      const live = (res?.data?.runs || []).find((r) => r.status === 'QUEUED' || r.status === 'RUNNING')
      if (live) setCurrent((c) => c || live)
    } catch (err) {
      setError(err?.message || 'Gagal memuat pengaturan sinkronisasi EIS.')
    }
  }, [])

  useEffect(() => {
    if (open) {
      setForm(null)
      setCurrent(null)
      setError('')
      setNotice('')
      load()
    }
    return () => clearTimeout(timer.current)
  }, [open, load])

  // ikuti satu sinkronisasi yang sedang berjalan sampai selesai
  useEffect(() => {
    clearTimeout(timer.current)
    if (!open || !current || !['QUEUED', 'RUNNING'].includes(current.status)) return undefined
    timer.current = setTimeout(async () => {
      try {
        const res = await eisSyncApi.run(current.id)
        setCurrent(res?.data)
        if (res?.data && !['QUEUED', 'RUNNING'].includes(res.data.status)) {
          load()
          if (res.data.status === 'OK') onSynced?.()
        }
      } catch {
        setCurrent((c) => ({ ...c }))
      }
    }, 3000)
    return () => clearTimeout(timer.current)
  }, [open, current, load, onSynced])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await eisSyncApi.save({ ...form, power_min: Number(form.power_min), power_max: Number(form.power_max), lookback_days: Number(form.lookback_days) })
      setSettings(res?.data)
      setForm((f) => ({ ...f, eis_password: '' }))
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
      const body = range.from && range.to ? { from: range.from, to: range.to } : {}
      const res = await eisSyncApi.start(body)
      setCurrent(res?.data)
    } catch (err) {
      setError(err?.message || 'Gagal memulai sinkronisasi.')
    } finally {
      setStarting(false)
    }
  }

  const running = current && ['QUEUED', 'RUNNING'].includes(current.status)
  const ready = Boolean(settings?.eis_username && settings?.has_password)

  return (
    <PanelShell asPage={asPage} onBack={onClose} open={open} onClose={onClose} title="Sinkronisasi EIS" subtitle="Tarik permohonan dari EIS langsung dari DISTRIVA" size="max-w-2xl">
      {!form ? (
        <p className="text-xs text-slate-500">Memuat…</p>
      ) : (
        <div className="space-y-5 text-xs">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          <p className="text-[11px] text-slate-500">
            Pelanggan baru diambil untuk <b>semua daya</b> dengan status <b>Bayar, Cetak PK, PDL Awal, dan Peremajaan</b>. Permohonan yang sudah ada di DISTRIVA hanya diperbarui <b>Hari Kerja</b> dan <b>Status Permohonan</b>.
          </p>

          <section className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">Akun & rentang EIS</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="User EIS"><input aria-label="User EIS" autoComplete="off" value={form.eis_username} onChange={set('eis_username')} className={inputCls} /></Field>
              <Field label="Password EIS" hint={settings?.has_password ? 'Tersimpan terenkripsi; kosongkan untuk tetap memakainya.' : 'Disimpan terenkripsi dan tidak pernah ditampilkan lagi.'}>
                <input aria-label="Password EIS" type="password" autoComplete="new-password" value={form.eis_password} onChange={set('eis_password')} placeholder={settings?.has_password ? '••••••••' : ''} className={inputCls} />
              </Field>
              <Field label="Daya minimum (VA)"><input aria-label="Daya minimum" type="number" min="0" value={form.power_min} onChange={set('power_min')} className={inputCls} /></Field>
              <Field label="Daya maksimum (VA)" hint="0 – 99.999.999 = semua daya."><input aria-label="Daya maksimum" type="number" min="0" value={form.power_max} onChange={set('power_max')} className={inputCls} /></Field>
              <Field label="Tarik mundur (hari)" hint="Rentang Tanggal Mohon = hari ini dikurangi jumlah hari ini."><input aria-label="Tarik mundur" type="number" min="1" max="730" value={form.lookback_days} onChange={set('lookback_days')} className={inputCls} /></Field>
            </div>
          </section>

          <section className="space-y-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">Sinkronisasi otomatis</h4>
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={form.auto_enabled} onChange={set('auto_enabled')} />
              Jalankan otomatis setiap hari
            </label>
            <Field label="Jam (WIB)" hint="Berjalan atas nama akun yang menyimpan pengaturan ini; butuh penjadwal server (`schedule:run`) aktif.">
              <input aria-label="Jam sinkronisasi otomatis" type="time" value={form.auto_time} onChange={set('auto_time')} className={`${inputCls} max-w-40`} />
            </Field>
          </section>

          <div className="flex justify-end">
            <Button onClick={save} loading={saving}>Simpan Pengaturan</Button>
          </div>

          <section className="space-y-3 p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20">
            <h4 className="font-bold text-slate-800 dark:text-slate-200">Sinkronkan sekarang</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Dari tanggal (opsional)"><input aria-label="Dari tanggal" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={inputCls} /></Field>
              <Field label="Sampai tanggal (opsional)"><input aria-label="Sampai tanggal" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={inputCls} /></Field>
            </div>
            <p className="text-[11px] text-slate-500">Kosongkan tanggal untuk memakai rentang bawaan ({form.lookback_days} hari terakhir).</p>
            <Button onClick={start} loading={starting} disabled={!ready || running || Boolean(range.from) !== Boolean(range.to)}>
              {running ? 'Sedang berjalan…' : 'Sinkronkan Sekarang'}
            </Button>
            {!ready && <p className="text-[11px] text-amber-600">Simpan user dan password EIS terlebih dulu.</p>}
            {current && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS[current.status]?.[1]}`}>{STATUS[current.status]?.[0] || current.status}</span>
                  <span className="text-slate-500">dimulai {when(current.started_at || current.created_at)}</span>
                </div>
                {current.log && <pre aria-label="Log sinkronisasi" className="max-h-64 overflow-auto p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] whitespace-pre-wrap">{current.log}</pre>}
              </div>
            )}
          </section>

          <section>
            <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2">Riwayat sinkronisasi</h4>
            {runs.length === 0 ? (
              <p className="text-slate-500">Belum ada sinkronisasi.</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-400 border-b"><th className="py-2 px-2">Waktu</th><th className="py-2 px-2">Pemicu</th><th className="py-2 px-2">Oleh</th><th className="py-2 px-2">Status</th><th className="py-2 px-2" /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 px-2">{when(r.created_at)}</td>
                      <td className="py-2 px-2">{r.trigger === 'AUTO' ? 'Otomatis' : 'Manual'}</td>
                      <td className="py-2 px-2">{r.started_by || '-'}</td>
                      <td className="py-2 px-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS[r.status]?.[1]}`}>{STATUS[r.status]?.[0] || r.status}</span></td>
                      <td className="py-2 px-2 text-right"><button type="button" className="text-blue-600 hover:underline cursor-pointer" onClick={async () => { const res = await eisSyncApi.run(r.id); setCurrent(res?.data) }}>Lihat log</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </PanelShell>
  )
}
