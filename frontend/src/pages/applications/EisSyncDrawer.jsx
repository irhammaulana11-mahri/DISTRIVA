import { useCallback, useEffect, useRef, useState } from 'react'
import { eisSyncApi } from '../../services/api.js'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Modal from '../../components/Modal.jsx'
import EisRunResults from './EisRunResults.jsx'
import {
  IconRefresh,
  IconCheck,
  IconShieldCheck,
  IconEye,
  IconEyeOff,
  IconClock,
  IconCalendar,
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
 * untuk penarikan data langsung dari server EIS PLN.
 *
 * Mendukung mode kontekstual via prop `mode`:
 * - 'permohonan': hanya menampilkan form penarikan Permohonan Pelanggan (PB/PD).
 * - 'piutang': hanya menampilkan form penarikan Laporan Saldo Piutang (Golongan, Lembar, Kogol).
 * - 'all' / null: menampilkan selector/tab atau mode kontekstual.
 */
export default function EisSyncDrawer({ open, asPage = false, mode = null, onClose, onSynced }) {
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(null)
  const [runs, setRuns] = useState([])
  const [units, setUnits] = useState([])
  const [picked, setPicked] = useState(null)       // null = semua unit; selain itu daftar kode ULP yang dipilih
  const [current, setCurrent] = useState(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const [completeOld, setCompleteOld] = useState(false)       // melengkapi permohonan lama (maks. 180 hari sebelum rentang): hanya bila pengguna memilihnya
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Tab internal jika mode = 'all' atau tidak ditentukan
  const [activeTab, setActiveTab] = useState(mode === 'piutang' ? 'piutang' : 'permohonan')

  // Sinkronkan activeTab bila prop mode berubah
  useEffect(() => {
    if (mode === 'piutang') {
      setActiveTab('piutang')
    } else if (mode === 'permohonan') {
      setActiveTab('permohonan')
    }
  }, [mode])

  // State untuk penarikan piutang
  const nowMonth = new Date().toISOString().slice(0, 7)
  const [piutangFromMonth, setPiutangFromMonth] = useState('')
  const [piutangToMonth, setPiutangToMonth] = useState(nowMonth)
  const [piutangReports, setPiutangReports] = useState(['GOLONGAN', 'LEMBAR', 'KOGOL', 'PRABAYAR'])
  const [piutangStarting, setPiutangStarting] = useState(false)
  const [piutangError, setPiutangError] = useState('')

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
      setUnits(res?.data?.units || [])
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
      setPicked(null)
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

  const allCodes = units.map((u) => u.code)
  const selected = picked ?? allCodes
  const toggleUnit = (code) => setPicked(selected.includes(code) ? selected.filter((c) => c !== code) : allCodes.filter((c) => c === code || selected.includes(c)))

  const start = async () => {
    setStarting(true)
    setError('')
    setNotice('')
    try {
      const body = range.from && range.to ? { from: range.from, to: range.to } : {}
      if (units.length > 0 && selected.length < units.length) body.units = selected      // semua unit = tanpa daftar; sebagian = hanya unit itu, berurutan
      if (completeOld) body.complete_old = true
      const res = await eisSyncApi.start(body)
      setCurrent(res?.data)
    } catch (err) {
      setError(err?.message || 'Gagal memulai sinkronisasi.')
    } finally {
      setStarting(false)
    }
  }

  const togglePiutangReport = (rep) => {
    setPiutangReports((prev) =>
      prev.includes(rep) ? prev.filter((r) => r !== rep) : [...prev, rep]
    )
  }

  const startPiutang = async () => {
    setPiutangStarting(true)
    setPiutangError('')
    setNotice('')
    try {
      const body = {
        kind: 'piutang',
        to_month: piutangToMonth,
        from_month: piutangFromMonth || piutangToMonth,
        reports: piutangReports,
      }
      if (units.length > 0 && selected.length < units.length) body.units = selected
      const res = await eisSyncApi.start(body)
      setCurrent(res?.data)
    } catch (err) {
      setPiutangError(err?.message || 'Gagal memulai penarikan saldo piutang.')
    } finally {
      setPiutangStarting(false)
    }
  }

  const running = current && ['QUEUED', 'RUNNING'].includes(current.status)
  const ready = Boolean(settings?.eis_username && settings?.has_password)

  // Metrik Ringkasan KPI
  const lastRun = runs[0] || null

  // Tentukan mode aktif: jika prop mode spesifik ('permohonan' | 'piutang'), kunci ke mode itu.
  // Jika tidak ('all' / null), ikuti activeTab yang bisa di-switch pengguna.
  const isPermohonan = mode === 'permohonan' || (!mode && activeTab === 'permohonan')
  const isPiutang = mode === 'piutang' || (!mode && activeTab === 'piutang')

  const titleText = isPiutang && !isPermohonan
    ? 'Sinkronisasi Saldo Piutang EIS'
    : 'Sinkronisasi EIS'
  const subtitleText = isPiutang && !isPermohonan
    ? 'Tarik laporan saldo piutang bulanan langsung dari server EIS ke DISTRIVA'
    : 'Tarik permohonan pelanggan PB/PD langsung dari server EIS ke DISTRIVA'

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={open}
      onClose={onClose}
      title={titleText}
      subtitle={subtitleText}
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
          {/* Kartu ringkasan: akun, otomasi, total riwayat, sesi terakhir */}
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
            <Button type="button" variant="secondary" size="sm" onClick={() => setSettingsOpen(true)} className="cursor-pointer">
              Pengaturan
            </Button>
          </div>

          {!settingsOpen && error && <Alert kind="error">{error}</Alert>}
          {!settingsOpen && notice && <Alert kind="success">{notice}</Alert>}

          {/* Tab Navigasi bila mode tidak dikunci ('all' atau null) */}
          {!mode && (
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('permohonan')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'permohonan'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Permohonan Pelanggan
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('piutang')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'piutang'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Laporan Saldo Piutang
              </button>
            </div>
          )}

          <div className="space-y-6">
            {isPermohonan && (
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
                    Pelanggan baru diambil untuk <b>semua daya</b> dan <b>semua status</b> (Mohon, Disetujui, Bayar, Cetak PK, PDL Awal, Peremajaan, dan lainnya); tabel Permohonan tinggal disaring menurut status. Permohonan yang sudah ada di DISTRIVA hanya diperbarui <b>Hari Kerja</b> dan <b>Status Permohonan</b>.
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
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={completeOld}
                      onChange={(e) => setCompleteOld(e.target.checked)}
                      aria-label="Lengkapi permohonan lama"
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <span className="text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Lengkapi permohonan lama</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Setelah rentang di atas selesai, tarik juga rentang sebelumnya (paling jauh 180 hari) agar permohonan yang masih berjalan di DISTRIVA tetapi sudah selesai di EIS ikut diperbarui. Berlaku untuk semua unit dan menambah waktu proses. Sinkron otomatis tidak melakukannya.
                      </span>
                    </span>
                  </label>
                </div>

                {/* Pilih unit yang disinkronkan */}
                {units.length > 0 && (
                  <fieldset className="space-y-2 pt-1" aria-label="Unit yang disinkronkan">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <legend className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                        Unit yang disinkronkan <span className="font-normal text-slate-500">({selected.length} dari {units.length}, diproses berurutan dari atas)</span>
                      </legend>
                      <div className="flex gap-3 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                        <button type="button" className="cursor-pointer hover:underline" onClick={() => setPicked(null)} disabled={running}>Pilih semua</button>
                        <button type="button" className="cursor-pointer hover:underline" onClick={() => setPicked([])} disabled={running}>Kosongkan</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {units.map((u) => (
                        <label key={u.code} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer ${selected.includes(u.code) ? 'border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                          <input type="checkbox" checked={selected.includes(u.code)} onChange={() => toggleUnit(u.code)} disabled={running} aria-label={`Sinkronkan ${u.code} ${u.name}`} />
                          <span className="font-mono">{u.code}</span> <span className="truncate">{u.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Unit dipilih di EIS satu per satu; tiap unit diunduh dan diunggah dulu sebelum lanjut ke unit berikutnya. Satu unit yang gagal tidak menghentikan yang lain.
                    </p>
                  </fieldset>
                )}

                {/* Tombol Eksekusi Penarikan Permohonan */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <Button
                    onClick={start}
                    loading={starting}
                    disabled={!ready || running || Boolean(range.from) !== Boolean(range.to) || (units.length > 0 && selected.length === 0)}
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto cursor-pointer"
                  >
                    <IconRefresh size={14} className={running && current?.kind !== 'piutang' ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                    {running && current?.kind !== 'piutang' ? 'Sedang berjalan…' : 'Sinkronkan Sekarang'}
                  </Button>

                  {!ready && (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Simpan user dan password EIS terlebih dulu.
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* KARTU: Tarik Laporan Piutang dari EIS */}
            {isPiutang && (
              <section className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      Tarik Laporan Piutang
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Tarik otomatis laporan saldo piutang bulanan (Per Golongan, Per Lembar, dan Kogol) langsung dari server EIS PLN.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                    Laporan EIS
                  </span>
                </div>

                <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 text-[11px] text-emerald-800 dark:text-emerald-300 space-y-1">
                  <p>
                    Laporan saldo piutang diunduh dari EIS dan langsung masuk ke modul <b>Laporan Bulanan EIS</b> serta <b>Analisa &amp; Tren Pengusahaan</b>.
                  </p>
                </div>

                {piutangError && <Alert kind="error">{piutangError}</Alert>}

                {/* Filter Periode Bulan */}
                <div className="space-y-3 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Periode Bulan Laporan
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Bulan akhir (wajib)" hint="Bulan mutasi target laporan">
                      <input
                        aria-label="Bulan akhir piutang"
                        type="month"
                        value={piutangToMonth}
                        onChange={(e) => setPiutangToMonth(e.target.value)}
                        className={inputCls}
                        required
                      />
                    </Field>
                    <Field label="Bulan awal (opsional)" hint="Kosongkan untuk hanya menarik bulan akhir saja">
                      <input
                        aria-label="Bulan awal piutang"
                        type="month"
                        value={piutangFromMonth}
                        onChange={(e) => setPiutangFromMonth(e.target.value)}
                        className={inputCls}
                        placeholder={piutangToMonth}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Bila bulan awal diisi, DISTRIVA akan menarik rentang bulan secara berurutan (paling banyak 24 bulan per sesi).
                  </p>
                </div>

                {/* Centang Laporan */}
                <div className="space-y-2 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Laporan yang Ditarik
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {[
                      { key: 'GOLONGAN', label: 'Per Golongan' },
                      { key: 'LEMBAR', label: 'Per Lembar' },
                      { key: 'KOGOL', label: 'Kogol' },
                      { key: 'PRABAYAR', label: 'Saldo Prabayar' },
                    ].map((rep) => (
                      <label
                        key={rep.key}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer select-none transition ${
                          piutangReports.includes(rep.key)
                            ? 'border-emerald-300 bg-emerald-50/70 text-emerald-900 font-semibold dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={piutangReports.includes(rep.key)}
                          onChange={() => togglePiutangReport(rep.key)}
                          disabled={running}
                          aria-label={`Laporan ${rep.label}`}
                          className="rounded text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>{rep.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Pilih unit yang disinkronkan untuk piutang (hanya bila kartu permohonan tidak tampil) */}
                {!isPermohonan && units.length > 0 && (
                  <fieldset className="space-y-2 pt-1" aria-label="Unit yang disinkronkan">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <legend className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                        Unit yang disinkronkan <span className="font-normal text-slate-500">({selected.length} dari {units.length}, diproses berurutan dari atas)</span>
                      </legend>
                      <div className="flex gap-3 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <button type="button" className="cursor-pointer hover:underline" onClick={() => setPicked(null)} disabled={running}>Pilih semua</button>
                        <button type="button" className="cursor-pointer hover:underline" onClick={() => setPicked([])} disabled={running}>Kosongkan</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {units.map((u) => (
                        <label key={u.code} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer ${selected.includes(u.code) ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                          <input type="checkbox" checked={selected.includes(u.code)} onChange={() => toggleUnit(u.code)} disabled={running} aria-label={`Sinkronkan ${u.code} ${u.name}`} />
                          <span className="font-mono">{u.code}</span> <span className="truncate">{u.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Unit dipilih di EIS satu per satu; tiap unit diunduh dan diunggah dulu sebelum lanjut ke unit berikutnya.
                    </p>
                  </fieldset>
                )}

                {/* Info Unit terpilih bila kartu permohonan tampil bersamaan */}
                {isPermohonan && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Unit yang ditarik mengikuti pilihan di atas ({selected.length} dari {units.length} unit).
                  </p>
                )}

                {/* Tombol Eksekusi Penarikan Piutang */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <Button
                    onClick={startPiutang}
                    loading={piutangStarting}
                    disabled={!ready || running || !piutangToMonth || piutangReports.length === 0 || (units.length > 0 && selected.length === 0)}
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white cursor-pointer"
                  >
                    <IconRefresh size={14} className={running && current?.kind === 'piutang' ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                    {running && current?.kind === 'piutang' ? 'Sedang menarik piutang…' : 'Tarik Piutang'}
                  </Button>

                  {!ready && (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Simpan user dan password EIS terlebih dulu.
                    </span>
                  )}
                </div>
              </section>
            )}
            <EisRunResults run={current} units={units} />
          </div>

          <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Pengaturan Sinkronisasi EIS" subtitle="Akun EIS, rentang daya, dan jadwal otomatis" size="max-w-3xl" width="max-w-3xl">
            <div className="space-y-5 text-xs">
              {error && <Alert kind="error">{error}</Alert>}
              {notice && <Alert kind="success">{notice}</Alert>}
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
          </Modal>
        </div>
      )}

    </PanelShell>
  )
}
