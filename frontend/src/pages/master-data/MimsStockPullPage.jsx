import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { warehousesApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import MimsSettingsDrawer from './MimsSettingsDrawer.jsx'
import {
  IconRefresh,
  IconCheck,
  IconZap,
  IconShieldCheck,
  IconEye,
  IconEyeOff,
  IconSettings,
} from '../../components/icons.jsx'

/**
 * Halaman Kerja Terpisah untuk Proses Penarikan Stok dari MIMS.
 * Desain proporsional, modern, user-friendly, dan memisahkan proses interaktif dari pengaturan otomatis.
 */
export default function MimsStockPullPage({ asPage = true, onClose, onSuccess, onOpenUnmapped }) {
  const navigate = useNavigate()
  const { notify } = useNotifications()

  // Data gudang
  const [warehouses, setWarehouses] = useState([])
  const [loadingWarehouses, setLoadingWarehouses] = useState(true)

  // Token state
  const [mimsSaved, setMimsSaved] = useState(null)
  const [mimsUseSaved, setMimsUseSaved] = useState(false)
  const [mimsToken, setMimsToken] = useState('')
  const [mimsSaveToken, setMimsSaveToken] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Filter & scope state
  const [mimsWarehouseIds, setMimsWarehouseIds] = useState([])
  const [mimsDate, setMimsDate] = useState('')
  const [mimsFrom, setMimsFrom] = useState('')
  const [mimsTo, setMimsTo] = useState('')
  const [mimsDryRun, setMimsDryRun] = useState(false)

  // Scope data state
  const [mimsDoStock, setMimsDoStock] = useState(true)
  const [mimsDoIssues, setMimsDoIssues] = useState(true)
  const [mimsDoReceipts, setMimsDoReceipts] = useState(true)
  const [mimsDoReservations, setMimsDoReservations] = useState(false)

  // Execution state
  const [mimsPulling, setMimsPulling] = useState(false)
  const [mimsResults, setMimsResults] = useState(null)
  const [mimsError, setMimsError] = useState('')

  // Settings drawer state
  const [settingsOpen, setSettingsOpen] = useState(false)

  const resultsRef = useRef(null)

  useEffect(() => {
    if (mimsResults && typeof resultsRef.current?.scrollIntoView === 'function') {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [mimsResults])

  const loadWarehouses = useCallback(async () => {
    setLoadingWarehouses(true)
    try {
      const res = await warehousesApi.list()
      setWarehouses(res?.data || [])
    } catch {
      setWarehouses([])
    } finally {
      setLoadingWarehouses(false)
    }
  }, [])

  const loadTokenStatus = useCallback(async () => {
    try {
      const res = await warehousesApi.mimsTokenStatus()
      const st = res?.data || null
      setMimsSaved(st)
      if (!st?.saved) {
        setMimsUseSaved(false)
      }
    } catch {
      setMimsSaved(null)
      setMimsUseSaved(false)
    }
  }, [])

  useEffect(() => {
    loadWarehouses()
    loadTokenStatus()
  }, [loadWarehouses, loadTokenStatus])

  const handleMimsPull = async (e) => {
    e?.preventDefault?.()
    if (!mimsDoStock && !mimsDoIssues && !mimsDoReceipts && !mimsDoReservations) {
      setMimsError('Pilih minimal satu jenis data: stok, pengeluaran, penerimaan, atau reservasi.')
      return
    }
    if (!mimsUseSaved && !mimsToken.trim()) {
      setMimsError('Token sesi MIMS wajib diisi.')
      return
    }

    setMimsPulling(true)
    setMimsError('')
    setMimsResults(null)
    const tokenToSend = mimsToken.trim()
    // Segera bersihkan token dari state memori peramban
    setMimsToken('')

    try {
      const res = await warehousesApi.syncStock(
        {
          ...(mimsUseSaved ? { use_saved_token: true } : { token: tokenToSend, ...(mimsSaveToken && { save_token: true }) }),
          warehouse_ids: mimsWarehouseIds.length > 0 ? mimsWarehouseIds : undefined,
          date: mimsDate || undefined,
          issues_from: (mimsDoIssues || mimsDoReceipts || mimsDoReservations) && mimsFrom ? mimsFrom : undefined,
          issues_to: (mimsDoIssues || mimsDoReceipts || mimsDoReservations) && mimsFrom && mimsTo ? mimsTo : undefined,
          dry_run: (mimsDryRun && mimsDoStock) || undefined,
          sync_stock: mimsDoStock,
          sync_issues: mimsDoIssues,
          sync_receipts: mimsDoReceipts,
          sync_reservations: mimsDoReservations || undefined,
        },
        (rows) => setMimsResults(rows)
      )

      setMimsResults(res?.data || [])
      notify({
        type: 'success',
        title: 'Penarikan Stok Berhasil',
        desc: `Berhasil memproses ${res?.data?.length || 0} gudang dari MIMS.`,
        tag: 'MIMS',
      })
      loadTokenStatus()
      onSuccess?.(res?.data)
    } catch (err) {
      loadTokenStatus()
      const msg = err?.message || 'Gagal menarik stok dari MIMS.'
      setMimsError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menarik Stok MIMS',
        desc: msg,
        tag: 'MIMS',
      })
    } finally {
      setMimsPulling(false)
    }
  }

  const handleSelectAllWarehouses = () => {
    const allIds = warehouses.filter((w) => w.plant && w.stor_loc).map((w) => w.id)
    setMimsWarehouseIds(allIds)
  }

  const handleClearWarehouses = () => {
    setMimsWarehouseIds([])
  }

  const activeErpWarehouses = warehouses.filter((w) => w.plant && w.stor_loc)

  // Metrik KPI Hasil Penarikan
  const kpiStats = mimsResults
    ? {
        totalGudang: mimsResults.length,
        okCount: mimsResults.filter((r) => r.status === 'OK').length,
        skippedCount: mimsResults.filter((r) => r.status === 'SKIPPED').length,
        errorCount: mimsResults.filter((r) => r.status !== 'OK' && r.status !== 'SKIPPED').length,
        totalSku: mimsResults.reduce((acc, r) => acc + (r.total || 0), 0),
        mappedSku: mimsResults.reduce((acc, r) => acc + (r.mapped || 0), 0),
        unmappedSku: mimsResults.reduce((acc, r) => acc + Math.max(0, (r.total || 0) - (r.mapped || 0)), 0),
      }
    : null

  const handleBack = onClose || (() => navigate('/master-data/warehouses'))

  const content = (
    <div className="space-y-6 text-xs">
      {/* Header Bar dengan Shortcut ke Pengaturan */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200 dark:border-blue-900/60">
        <div className="flex items-start gap-2.5">
          <IconShieldCheck size={18} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-blue-950 dark:text-blue-100">
              Koneksi Aman & Perlindungan Kredensial
            </div>
              <p className="text-[11px] text-blue-700 dark:text-blue-300">
                Token sesi MIMS ditransmisikan lewat HTTPS terenkripsi. Bila disimpan, token dilindungi enkripsi AES-256 pada server untuk akun Anda.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="cursor-pointer"
          >
            <IconSettings size={14} className="mr-1.5" />
            Pengaturan Tarik Otomatis
          </Button>
        </div>

        {/* Pesan Galat */}
        {mimsError && (
          <Alert kind="error">
            <div className="font-semibold">{mimsError}</div>
            {(mimsError.toLowerCase().includes('token ditolak') ||
              mimsError.toLowerCase().includes('kedaluwarsa')) && (
              <div className="mt-1 text-[11px]">
                Token sesi Anda mungkin sudah kedaluwarsa. Silakan ambil token baru dari aplikasi MIMS lalu pilih opsi &quot;Tempel token baru&quot;.
              </div>
            )}
          </Alert>
        )}

        <form onSubmit={handleMimsPull} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* KOLOM KIRI: Autentikasi & Cakupan Gudang */}
            <div className="space-y-5">
              {/* KARTU 1: Kredensial Token Sesi MIMS */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    1. Autentikasi Token MIMS
                  </h3>
                  {mimsSaved?.saved && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      Token Tersimpan Tersedia
                    </span>
                  )}
                </div>

                {mimsSaved?.saved && (
                  <div className="space-y-2" role="radiogroup" aria-label="Sumber token MIMS">
                    <label
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                        mimsUseSaved
                          ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800'
                          : 'bg-slate-50/50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="mims-source"
                        checked={mimsUseSaved}
                        onChange={() => setMimsUseSaved(true)}
                        disabled={mimsPulling}
                        className="mt-0.5"
                      />
                      <div className="space-y-0.5">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          Gunakan token tersimpan
                        </span>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Disimpan {mimsSaved.saved_at ? new Date(mimsSaved.saved_at).toLocaleDateString('id-ID') : '-'}
                          {mimsSaved.last_used_at ? ` · terakhir dipakai ${new Date(mimsSaved.last_used_at).toLocaleDateString('id-ID')}` : ''}
                        </p>
                        {mimsSaved.last_result === 'REJECTED' && (
                          <span className="block text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                            Pemakaian terakhir ditolak MIMS; coba lagi, atau tempel token baru.
                          </span>
                        )}
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                        !mimsUseSaved
                          ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800'
                          : 'bg-slate-50/50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="mims-source"
                        checked={!mimsUseSaved}
                        onChange={() => setMimsUseSaved(false)}
                        disabled={mimsPulling}
                        className="mt-0.5"
                      />
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Tempel token baru
                      </span>
                    </label>
                  </div>
                )}

                {!mimsUseSaved && (
                  <div className="space-y-2 pt-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      Token Sesi MIMS <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="off"
                        required={!mimsUseSaved}
                        disabled={mimsPulling}
                        value={mimsToken}
                        onChange={(e) => setMimsToken(e.target.value)}
                        placeholder="Tempel token sesi MIMS Anda di sini..."
                        className="block w-full px-3 py-2 pr-10 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        title={showPassword ? 'Sembunyikan token' : 'Tampilkan token'}
                      >
                        {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                      </button>
                    </div>

                    <label className="flex items-center gap-2 pt-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mimsSaveToken}
                        onChange={(e) => setMimsSaveToken(e.target.checked)}
                        disabled={mimsPulling}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>
                        Simpan token ini untuk penarikan berikutnya{' '}
                        {mimsSaved?.saved && <span className="text-slate-400">(menggantikan token lama)</span>}
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* KARTU 2: Filter Gudang ERP & Periode */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    2. Pilihan Gudang & Periode
                  </h3>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={handleSelectAllWarehouses}
                      className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Pilih Semua
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <button
                      type="button"
                      onClick={handleClearWarehouses}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Gudang ERP yang Ditarik:
                  </label>
                  <select
                    multiple
                    disabled={mimsPulling}
                    value={mimsWarehouseIds}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions, (option) => option.value)
                      setMimsWarehouseIds(selected)
                    }}
                    className="block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 h-28 focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  >
                    {activeErpWarehouses.map((w) => (
                      <option key={w.id} value={w.id} className="py-1">
                        {w.code} - {w.name} ({w.plant}/{w.stor_loc})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {mimsWarehouseIds.length === 0
                      ? 'Bawaan: Seluruh gudang aktif dengan Plant/Storage Loc'
                      : `${mimsWarehouseIds.length} gudang dipilih (tahan Ctrl/Cmd untuk memilih beberapa gudang)`}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Tanggal Cuplikan Stok
                    </label>
                    <input
                      type="date"
                      disabled={mimsPulling}
                      max={new Date().toISOString().slice(0, 10)}
                      value={mimsDate}
                      onChange={(e) => setMimsDate(e.target.value)}
                      className="block w-full px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      Kosongkan untuk menarik stok hari ini.
                    </p>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Rentang Mutasi (Pengeluaran/Penerimaan)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        aria-label="Rentang dari"
                        disabled={mimsPulling}
                        max={new Date().toISOString().slice(0, 10)}
                        value={mimsFrom}
                        onChange={(e) => setMimsFrom(e.target.value)}
                        className="block w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      />
                      <span className="text-slate-400 text-xs">s/d</span>
                      <input
                        type="date"
                        aria-label="Rentang sampai"
                        disabled={mimsPulling || !mimsFrom}
                        min={mimsFrom || undefined}
                        max={new Date().toISOString().slice(0, 10)}
                        value={mimsTo}
                        onChange={(e) => setMimsTo(e.target.value)}
                        className="block w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      />
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      Kosongkan untuk 90 hari terakhir.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* KOLOM KANAN: Pilihan Jenis Data & Eksekusi */}
            <div className="space-y-5">
              {/* KARTU 3: Jenis Data yang Ditarik */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xs">
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  3. Jenis Data yang Ditarik
                </h3>

                <div className="space-y-2.5">
                  {[
                    {
                      id: 'mims-do-stock',
                      title: 'Stok Fisik Gudang',
                      desc: 'Saldo kuantitas material terkini di seluruh gudang ERP.',
                      checked: mimsDoStock,
                      set: setMimsDoStock,
                    },
                    {
                      id: 'mims-do-issues',
                      title: 'Pengeluaran Material',
                      desc: 'Riwayat dokumen mutasi pengeluaran barang (pemakaian).',
                      checked: mimsDoIssues,
                      set: setMimsDoIssues,
                    },
                    {
                      id: 'mims-do-receipts',
                      title: 'Penerimaan Material',
                      desc: 'Riwayat dokumen penerimaan barang masuk dari rekanan/vendor.',
                      checked: mimsDoReceipts,
                      set: setMimsDoReceipts,
                    },
                    {
                      id: 'mims-do-reservations',
                      title: 'Reservasi Material',
                      desc: 'Data alokasi reservasi material yang belum dikeluarkan.',
                      checked: mimsDoReservations,
                      set: setMimsDoReservations,
                    },
                  ].map((item) => (
                    <label
                      key={item.id}
                      htmlFor={item.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                        item.checked
                          ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900'
                          : 'bg-white dark:bg-slate-800/30 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        id={item.id}
                        disabled={mimsPulling}
                        checked={item.checked}
                        onChange={(e) => item.set(e.target.checked)}
                        className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                      />
                      <div className="space-y-0.5">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                          {item.title}
                        </span>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {item.desc}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Dry Run Checkbox */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      id="mims-dry-run"
                      disabled={mimsPulling || !mimsDoStock}
                      checked={mimsDryRun && mimsDoStock}
                      onChange={(e) => setMimsDryRun(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>Uji coba tanpa menyimpan (dry run)</span>
                  </label>
                  <p className="text-[10px] text-slate-400 mt-0.5 ml-5">
                    Hanya memeriksa respons server MIMS tanpa memperbarui basis data stok lokal.
                  </p>
                </div>
              </div>

              {/* KARTU 4: Eksekusi Penarikan */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xs">
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  4. Eksekusi Penarikan
                </h3>

                {mimsPulling && (
                  <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-200 flex items-center gap-3">
                    <Spinner size="sm" />
                    <div>
                      <div className="font-bold">Sedang Menghubungi Server MIMS…</div>
                      <div className="text-[11px] text-blue-600 dark:text-blue-300">
                        Proses ini dapat memakan waktu 10-60 detik tergantung jumlah gudang dan volume material.
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    disabled={mimsPulling}
                    onClick={handleBack}
                  >
                    Batal
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={mimsPulling}
                    disabled={mimsPulling}
                    icon={IconRefresh}
                  >
                    {mimsPulling ? 'Menarik Stok...' : 'Tarik Stok Sekarang'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* AREA HASIL PENARIKAN (MIMS RESULTS) */}
        {mimsResults && (
          <div ref={resultsRef} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Hasil Penarikan Stok MIMS
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ringkasan status sinkronisasi material per gudang ERP.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setMimsResults(null)
                    setMimsError('')
                  }}
                >
                  Tarik Ulang
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleBack}
                >
                  Tutup / Selesai
                </Button>
              </div>
            </div>

            {/* Metrik Ringkasan KPI (Halaman Penuh) */}
            {asPage && kpiStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Gudang Diproses</div>
                  <div className="text-lg font-bold font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {kpiStats.okCount} / {kpiStats.totalGudang} <span className="text-xs font-normal text-emerald-600">sukses</span>
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Total SKU Material</div>
                  <div className="text-lg font-bold font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {kpiStats.totalSku.toLocaleString('id-ID')}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">SKU Terpetakan</div>
                  <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {kpiStats.mappedSku.toLocaleString('id-ID')}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Belum Terpetakan</div>
                  <div className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                    {kpiStats.unmappedSku.toLocaleString('id-ID')}
                  </div>
                </div>
              </div>
            )}

            {/* Tabel Rinci Hasil Penarikan */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Gudang</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Total SKU</th>
                    <th className="py-2.5 px-3 text-right">Terpetakan</th>
                    <th className="py-2.5 px-3 text-right">Belum Dipetakan</th>
                    <th className="py-2.5 px-3">Keterangan</th>
                    <th className="py-2.5 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                  {mimsResults.map((r, idx) => {
                    const total = r.total || 0
                    const mapped = r.mapped || 0
                    const unmappedCount = total - mapped
                    return (
                      <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          <div>{r.warehouse_name || r.warehouse_code || r.warehouse_id}</div>
                          <div className="text-[10px] font-mono text-slate-400">{r.warehouse_code}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              r.status === 'OK'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : r.status === 'SKIPPED'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold">
                          {total.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-600 font-semibold">
                          {mapped.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-amber-600 font-semibold">
                          {unmappedCount > 0 ? unmappedCount.toLocaleString('id-ID') : 0}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                          {r.message || '-'}
                          {r.receipts && (
                            <span className="block text-slate-500 mt-0.5">
                              Penerimaan: {r.receipts.status === 'OK' ? (r.receipts.documents_new === 0 ? 'tidak ada dokumen baru' : `${r.receipts.documents_new} dokumen baru, ${r.receipts.lines} baris material`) : r.receipts.message || r.receipts.status}
                            </span>
                          )}
                          {r.reservations && (
                            <span className="block text-slate-500 mt-0.5">
                              Reservasi: {r.reservations.status === 'OK' ? (r.reservations.documents_new === 0 ? 'tidak ada reservasi baru' : `${r.reservations.documents_new} reservasi baru, ${r.reservations.matched} cocok permohonan`) : r.reservations.message || r.reservations.status}
                            </span>
                          )}
                          {r.issues && (
                            <span className="block text-slate-500 mt-0.5">
                              Pengeluaran: {r.issues.status === 'OK' ? (r.issues.documents_new === 0 ? 'tidak ada dokumen baru' : `${r.issues.documents_new} dokumen baru, ${r.issues.lines} baris material`) : r.issues.message || r.issues.status}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {r.snapshot_id ? (
                            onOpenUnmapped || !asPage ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (onOpenUnmapped) {
                                    onOpenUnmapped(r.snapshot_id, r.warehouse_name)
                                  } else {
                                    navigate(`/master-data/mapping?snapshot_id=${r.snapshot_id}`)
                                  }
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                SKU Belum Terpetakan
                              </button>
                            ) : (
                              <Link
                                to={`/master-data/mapping?snapshot_id=${r.snapshot_id}`}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                SKU Belum Terpetakan →
                              </Link>
                            )
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Drawer Pengaturan Tarik Otomatis & Token Sesi MIMS */}
        <MimsSettingsDrawer
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => loadTokenStatus()}
        />
      </div>
  )

  if (!asPage) {
    return content
  }

  return (
    <PanelShell
      asPage={true}
      isOpen={true}
      onClose={handleBack}
      onBack={handleBack}
      title="Tarik Stok dari MIMS"
      subtitle="Sinkronisasi posisi stok fisik, pengeluaran, penerimaan, dan reservasi material langsung dari server MIMS"
      size="max-w-4xl"
      width="max-w-4xl"
    >
      {content}
    </PanelShell>
  )
}
