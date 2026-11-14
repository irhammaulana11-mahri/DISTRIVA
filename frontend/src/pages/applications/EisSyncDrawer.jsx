import { useCallback, useEffect, useRef, useState } from 'react'
import { eisSyncApi } from '../../services/api.js'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Modal from '../../components/Modal.jsx'
import {
  IconRefresh,
  IconCheck,
  IconShieldCheck,
  IconEye,
  IconEyeOff,
  IconClock,
  IconCalendar,
  IconClipboard,
  IconX,
} from '../../components/icons.jsx'

const inputCls =
  'block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all'

const STATUS = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  RUNNING: ['Berjalan', 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'],
  OK: ['Selesai', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'],
  FAILED: ['Gagal', 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'],
}

const when = (v) =>
  v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

function Field({ label, hint, children }) {
  return (
    <label className="block text-xs">
      <span className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

/**
 * Sinkronisasi EIS dari DISTRIVA:
 * Antarmuka proporsional, interaktif, user-friendly, aman, dan responsif
 * untuk penarikan permohonan pelanggan PB/PD langsung dari server EIS PLN.
 */
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
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedLogRun, setSelectedLogRun] = useState(null)
  const timer = useRef(null)
  const logRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await eisSyncApi.show()
      const s = res?.data?.settings
      setSettings(s)
      setForm((f) => f || {
        eis_username: s?.eis_username || '',
        eis_password: '',
        power_min: s?.power_min ?? 0,
        power_max: s?.power_max ?? 99999999,
        lookback_days: s?.lookback_days ?? 180,
        auto_enabled: Boolean(s?.auto_enabled),
        auto_time: s?.auto_time || '18:13',
      })
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
      setShowPassword(false)
      load()
    }
    return () => clearTimeout(timer.current)
  }, [open, load])

  // Ikuti satu sinkronisasi yang sedang berjalan sampai selesai
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

  // Auto-scroll log saat ada pembaruan
  useEffect(() => {
    if (current?.log && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [current?.log])

  const set = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await eisSyncApi.save({
        ...form,
        power_min: Number(form.power_min),
        power_max: Number(form.power_max),
        lookback_days: Number(form.lookback_days),
      })
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

  const handleCopyLog = (text) => {
    if (!text) return
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const running = current && ['QUEUED', 'RUNNING'].includes(current.status)
  const ready = Boolean(settings?.eis_username && settings?.has_password)

  // Metrik Ringkasan KPI
  const lastRun = runs[0] || null

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={open}
      onClose={onClose}
      title="Sinkronisasi EIS"
      subtitle="Tarik permohonan dari EIS langsung dari DISTRIVA"
      size={asPage ? 'max-w-6xl' : 'max-w-2xl'}
      width={asPage ? 'max-w-6xl' : 'max-w-2xl'}
    >
      {!form ? (
        <div className="py-16 text-center text-xs text-slate-500">
          <IconRefresh size={24} className="animate-spin mx-auto text-blue-600 mb-2" />
          <p>Memuat pengaturan dan riwayat sinkronisasi EIS…</p>
        </div>
      ) : (
        <div className="space-y-6 text-xs">
          {/* Banner Informasi Keamanan & Enkripsi */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200 dark:border-blue-900/60 shadow-xs">
            <div className="flex items-start gap-3">
              <IconShieldCheck size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold text-sm text-blue-950 dark:text-blue-100 flex items-center gap-2">
                  <span>Koneksi Aman & Perlindungan Kredensial EIS</span>
                  {ready ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      Tersimpan & Terenkripsi AES-256
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      Kredensial Belum Lengkap
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-blue-700 dark:text-blue-300 max-w-3xl">
                  Password akun EIS dienkripsi AES-256 pada database server dan tidak pernah dikirim kembali ke browser. Token otorisasi API pekerja sinkronisasi bersifat sementara dan langsung dicabut seketika setelah proses selesai.
                </p>
              </div>
            </div>
          </div>

          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}

          {/* Grid Utama 2 Kolom (Desktop) / 1 Kolom (Mobile) */}
          <div className={`grid grid-cols-1 ${asPage ? 'lg:grid-cols-12' : ''} gap-6`}>
            {/* KOLOM KIRI: Meja Kerja Penarikan Data Permohonan */}
            <div className={`space-y-5 ${asPage ? 'lg:col-span-6' : ''}`}>
              <section className="p-5 rounded-2xl border border-blue-200 dark:border-blue-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      Tarik Permohonan dari EIS Langsung
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Eksekusi penarikan data agenda penyambungan (PB/PD) secara online.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                    Online Pull
                  </span>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Cakupan Data yang Ditarik:</div>
                  <p>
                    Pelanggan baru diambil untuk <b>semua daya</b> dengan status <b>Bayar, Cetak PK, PDL Awal, dan Peremajaan</b>. Permohonan yang sudah ada di DISTRIVA hanya diperbarui <b>Hari Kerja</b> dan <b>Status Permohonan</b>.
                  </p>
                </div>

                {/* Filter Rentang Tanggal Mohon */}
                <div className="space-y-3 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Rentang Tanggal Permohonan
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Dari tanggal (opsional)">
                      <input
                        aria-label="Dari tanggal"
                        type="date"
                        value={range.from}
                        onChange={(e) => setRange({ ...range, from: e.target.value })}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Sampai tanggal (opsional)">
                      <input
                        aria-label="Sampai tanggal"
                        type="date"
                        value={range.to}
                        onChange={(e) => setRange({ ...range, to: e.target.value })}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Kosongkan tanggal untuk memakai rentang bawaan ({form.lookback_days} hari terakhir).
                  </p>
                </div>

                {/* Tombol Eksekusi Penarikan */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <Button
                    onClick={start}
                    loading={starting}
                    disabled={!ready || running || Boolean(range.from) !== Boolean(range.to)}
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto"
                  >
                    <IconRefresh size={14} className={running ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                    {running ? 'Sedang berjalan…' : 'Sinkronkan Sekarang'}
                  </Button>

                  {!ready && (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Simpan user dan password EIS terlebih dulu.
                    </span>
                  )}
                </div>

                {/* Monitor Proses Berjalan / Status Terkini */}
                {current && (
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS[current.status]?.[1]}`}>
                          {STATUS[current.status]?.[0] || current.status}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300 font-medium text-xs">
                          dimulai {when(current.started_at || current.created_at)}
                        </span>
                      </div>
                      {current.log && (
                        <button
                          type="button"
                          onClick={() => handleCopyLog(current.log)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <IconClipboard size={13} />
                          <span>{copied ? 'Tersalin!' : 'Salin Log'}</span>
                        </button>
                      )}
                    </div>

                    {current.log && (
                      <div className="relative rounded-xl overflow-hidden border border-slate-800 dark:border-slate-700 bg-slate-900">
                        <pre
                          ref={logRef}
                          aria-label="Log sinkronisasi"
                          className="max-h-64 overflow-auto p-3 text-slate-100 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-all"
                        >
                          {current.log}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* KOLOM KANAN: Konfigurasi Kredensial & Pengaturan Otomasi */}
            <div className={`space-y-5 ${asPage ? 'lg:col-span-6' : ''}`}>
              {/* KARTU 1: Akun & Parameter Rentang EIS */}
              <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Akun & rentang EIS
                  </h4>
                  <span className="text-[11px] text-slate-400">Parameter Koneksi</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Field label="User EIS">
                    <input
                      aria-label="User EIS"
                      autoComplete="off"
                      value={form.eis_username}
                      onChange={set('eis_username')}
                      placeholder="e.g. petugas.eis"
                      className={inputCls}
                    />
                  </Field>

                  <Field
                    label="Password EIS"
                    hint={
                      settings?.has_password
                        ? 'Tersimpan terenkripsi; kosongkan untuk tetap memakainya.'
                        : 'Disimpan terenkripsi dan tidak pernah ditampilkan lagi.'
                    }
                  >
                    <div className="relative">
                      <input
                        aria-label="Password EIS"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.eis_password}
                        onChange={set('eis_password')}
                        placeholder={settings?.has_password ? '••••••••' : 'Masukkan password EIS'}
                        className={`${inputCls} pr-9`}
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                      </button>
                    </div>
                  </Field>

                  <Field label="Daya minimum (VA)">
                    <input
                      aria-label="Daya minimum"
                      type="number"
                      min="0"
                      value={form.power_min}
                      onChange={set('power_min')}
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Daya maksimum (VA)" hint="0 – 99.999.999 = semua daya.">
                    <input
                      aria-label="Daya maksimum"
                      type="number"
                      min="0"
                      value={form.power_max}
                      onChange={set('power_max')}
                      className={inputCls}
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field
                      label="Tarik mundur (hari)"
                      hint="Rentang Tanggal Mohon = hari ini dikurangi jumlah hari ini."
                    >
                      <input
                        aria-label="Tarik mundur"
                        type="number"
                        min="1"
                        max="730"
                        value={form.lookback_days}
                        onChange={set('lookback_days')}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                </div>
              </section>

              {/* KARTU 2: Sinkronisasi Otomatis Harian */}
              <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Sinkronisasi otomatis
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      form.auto_enabled
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {form.auto_enabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>

                <div className="space-y-3">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.auto_enabled}
                      onChange={set('auto_enabled')}
                      aria-label="Jalankan otomatis setiap hari"
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Jalankan otomatis setiap hari
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Sistem melakukan penarikan otomatis agenda PB/PD secara berkala di latar belakang.
                      </p>
                    </div>
                  </label>

                  <Field
                    label="Jam (WIB)"
                    hint="Berjalan atas nama akun yang menyimpan pengaturan ini; butuh penjadwal server (`schedule:run`) aktif."
                  >
                    <input
                      aria-label="Jam sinkronisasi otomatis"
                      type="time"
                      value={form.auto_time}
                      onChange={set('auto_time')}
                      className={`${inputCls} max-w-44 font-mono font-bold`}
                    />
                  </Field>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button onClick={save} loading={saving} variant="primary" size="md">
                    <IconCheck size={14} className="mr-1.5" />
                    Simpan Pengaturan
                  </Button>
                </div>
              </section>
            </div>
          </div>

          {/* BAGIAN BAWAH: KPI Ringkasan & Tabel Riwayat Sinkronisasi */}
          <div className="space-y-4 pt-2">
            {/* Kartu Ringkasan KPI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Akun EIS</div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">
                  {settings?.eis_username || 'Belum diatur'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {settings?.has_password ? 'Password aman tersimpan' : 'Password belum ada'}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Otomasi Harian</div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                  {settings?.auto_enabled ? `Pukul ${settings?.auto_time} WIB` : 'Nonaktif'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {settings?.auto_enabled ? 'Penjadwalan aktif' : 'Manual saja'}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Riwayat</div>
                <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-1">
                  {runs.length} Sesi
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  10 sesi penarikan terakhir
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Sesi Terakhir</div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                  {lastRun ? (
                    <span className={lastRun.status === 'OK' ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}>
                      {STATUS[lastRun.status]?.[0] || lastRun.status}
                    </span>
                  ) : (
                    'Belum ada'
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {lastRun ? when(lastRun.created_at) : '-'}
                </div>
              </div>
            </div>

            {/* Tabel Riwayat Sinkronisasi */}
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Riwayat Sinkronisasi
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Catatan riwayat penarikan berkala data permohonan dari server EIS PLN.
                  </p>
                </div>
                <span className="text-xs font-semibold text-slate-500">
                  {runs.length} sesi tercatat
                </span>
              </div>

              {runs.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <p className="font-semibold">Belum ada sinkronisasi.</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Klik tombol &quot;Sinkronkan Sekarang&quot; untuk menarik data permohonan pertama kali.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <th className="py-3 px-4">Waktu Eksekusi</th>
                        <th className="py-3 px-4">Pemicu</th>
                        <th className="py-3 px-4">Rentang Tanggal</th>
                        <th className="py-3 px-4">Dijalankan Oleh</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans">
                      {runs.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200">
                            {when(r.created_at)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              {r.trigger === 'AUTO' ? 'Otomatis' : 'Manual'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-[11px]">
                            {r.range_from && r.range_to ? (
                              <span className="font-mono font-medium">
                                {r.range_from} s/d {r.range_to}
                              </span>
                            ) : (
                              <span className="text-slate-400">Bawaan ({form.lookback_days} hari)</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-[11px]">
                            {r.started_by || '-'}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                STATUS[r.status]?.[1] || 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {STATUS[r.status]?.[0] || r.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer text-xs"
                              onClick={async () => {
                                const res = await eisSyncApi.run(r.id)
                                setCurrent(res?.data)
                                setSelectedLogRun(res?.data)
                              }}
                            >
                              Lihat log
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Modal Detail Log Riwayat */}
      {selectedLogRun && (
        <Modal
          open={Boolean(selectedLogRun)}
          title={`Detail Log Sinkronisasi EIS (${selectedLogRun.id})`}
          onClose={() => setSelectedLogRun(null)}
          size="max-w-3xl"
        >
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS[selectedLogRun.status]?.[1]}`}>
                  {STATUS[selectedLogRun.status]?.[0] || selectedLogRun.status}
                </span>
                <span className="text-slate-600 dark:text-slate-300 text-[11px]">
                  Pemicu: <b>{selectedLogRun.trigger === 'AUTO' ? 'Otomatis' : 'Manual'}</b> · {when(selectedLogRun.created_at)}
                </span>
              </div>
              {selectedLogRun.log && (
                <button
                  type="button"
                  onClick={() => handleCopyLog(selectedLogRun.log)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <IconClipboard size={13} />
                  <span>{copied ? 'Tersalin!' : 'Salin Semua Log'}</span>
                </button>
              )}
            </div>

            <div className="rounded-xl overflow-hidden border border-slate-800 dark:border-slate-700 bg-slate-900">
              <pre className="max-h-80 overflow-auto p-4 text-slate-100 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-all">
                {selectedLogRun.log || '(Tidak ada catatan log pada sesi sinkronisasi ini)'}
              </pre>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button type="button" variant="secondary" onClick={() => setSelectedLogRun(null)}>
                Tutup
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PanelShell>
  )
}
