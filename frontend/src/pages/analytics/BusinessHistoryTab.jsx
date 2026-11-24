import { useEffect, useMemo, useState } from 'react'
import { pengusahaanApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Pagination from '../../components/Pagination.jsx'
import {
  IconDatabase,
  IconCheck,
  IconX,
  IconClock,
  IconFileText,
  IconAlertCircle,
  IconLock,
} from '../../components/icons.jsx'
import { fmtInt, monthLabel } from '../../components/TrendCharts.jsx'

const fmtDate = (v) => {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
]

/**
 * Tab Histori Sinkronisasi & Kelengkapan Sumber Data (docs/91 §3c, Butir 14 & 15):
 * - Matriks kelengkapan rentang 1 tahun per ULP dengan filter tahun (coverage)
 * - Riwayat sesi penarikan sinkronisasi dengan pagination & per-page filter (syncs)
 * - Daftar berkas impor laporan terbaru dengan pagination & per-page filter (files)
 * - Riwayat masukan kWh beli dengan pagination & per-page filter (inputs, untuk susut)
 */
export default function BusinessHistoryTab({ metricCode, unitId }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })

  // State filter tahun untuk Matriks Kelengkapan 1 Tahun
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  // State pagination untuk tabel Sesi Sinkronisasi
  const [syncsPage, setSyncsPage] = useState(1)
  const [syncsPerPage, setSyncsPerPage] = useState(10)

  // State pagination untuk tabel Berkas Laporan
  const [filesPage, setFilesPage] = useState(1)
  const [filesPerPage, setFilesPerPage] = useState(10)

  // State pagination untuk tabel Masukan Bulanan Susut
  const [inputsPage, setInputsPage] = useState(1)
  const [inputsPerPage, setInputsPerPage] = useState(10)

  useEffect(() => {
    let alive = true
    setState({ loading: true, error: '', data: null })

    pengusahaanApi
      .history(metricCode, { unit_id: unitId || undefined })
      .then((res) => {
        if (!alive) return
        setState({ loading: false, error: '', data: res?.data || null })
        if (res?.data?.latest_month) {
          const yr = parseInt(res.data.latest_month.slice(0, 4), 10)
          if (!Number.isNaN(yr)) setSelectedYear(yr)
        }
      })
      .catch((err) => {
        if (!alive) return
        setState({
          loading: false,
          error: err?.message || 'Gagal memuat histori sumber data.',
          data: null,
        })
      })

    return () => {
      alive = false
    }
  }, [metricCode, unitId])

  const d = state.data
  const coverage = d?.coverage
  const months = d?.months || []
  const files = d?.files || []
  const inputs = d?.inputs || []
  const syncs = d?.syncs
  const families = d?.families || (d?.family ? [d.family] : [])

  // Ekstrak tahun unik dari data months untuk pilihan filter tahun
  const availableYears = useMemo(() => {
    const yrSet = new Set()
    months.forEach((m) => {
      const y = parseInt(m.slice(0, 4), 10)
      if (!Number.isNaN(y)) yrSet.add(y)
    })
    const curYear = new Date().getFullYear()
    yrSet.add(curYear)
    yrSet.add(curYear - 1)
    return Array.from(yrSet).sort((a, b) => b - a)
  }, [months])

  // Filter 12 bulan (Jan - Des) untuk tahun terpilih
  const yearMonths = useMemo(() => {
    const yrStr = String(selectedYear)
    return Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0')
      return `${yrStr}-${mm}`
    })
  }, [selectedYear])

  // Hitung ketersediaan per unit untuk 12 bulan tahun terpilih
  const yearCoverageUnits = useMemo(() => {
    if (!coverage?.units) return []
    return coverage.units.map((u) => {
      // Map ketersediaan bulan dari data backend
      const monthMap = {}
      months.forEach((m, idx) => {
        monthMap[m] = u.months?.[idx] ?? false
      })

      const unitYearMonths = yearMonths.map((ym) => Boolean(monthMap[ym]))
      const missingCount = unitYearMonths.filter((has) => !has).length

      return {
        unit_id: u.unit_id,
        unit_name: u.unit_name,
        months: unitYearMonths,
        missing_count: missingCount,
      }
    })
  }, [coverage?.units, months, yearMonths])

  const totalMissingYear = useMemo(() => {
    return yearCoverageUnits.reduce((acc, u) => acc + u.missing_count, 0)
  }, [yearCoverageUnits])

  // Pagination untuk Sesi Sinkronisasi
  const paginatedSyncs = useMemo(() => {
    if (!Array.isArray(syncs)) return []
    const start = (syncsPage - 1) * syncsPerPage
    return syncs.slice(start, start + syncsPerPage)
  }, [syncs, syncsPage, syncsPerPage])

  // Pagination untuk Berkas Laporan
  const paginatedFiles = useMemo(() => {
    const start = (filesPage - 1) * filesPerPage
    return files.slice(start, start + filesPerPage)
  }, [files, filesPage, filesPerPage])

  // Pagination untuk Masukan Bulanan Susut
  const paginatedInputs = useMemo(() => {
    const start = (inputsPage - 1) * inputsPerPage
    return inputs.slice(start, start + inputsPerPage)
  }, [inputs, inputsPage, inputsPerPage])

  if (state.loading) {
    return (
      <div className="py-20 flex justify-center items-center">
        <Spinner />
      </div>
    )
  }

  if (state.error) {
    return <Alert type="error">{state.error}</Alert>
  }

  if (!d) return null

  return (
    <div className="space-y-6">
      {/* Kartu Header Informasi Sumber */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <IconDatabase size={18} className="text-blue-600" />
              Sumber Data &amp; Riwayat Sinkronisasi
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Kelengkapan laporan bulanan, berkas yang diimpor, dan sesi penarikan sinkronisasi data terkait.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {families.map((f) => (
              <span
                key={f}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-mono"
              >
                Laporan EIS: {f}
              </span>
            ))}
            {d.latest_month && (
              <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                Bulan Terakhir: {monthLabel(d.latest_month)}
              </span>
            )}
          </div>
        </div>

        {/* Informasi bila membutuhkan 2 jenis laporan (anomali) */}
        {d.families?.length > 1 && (
          <div className="mt-3 p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <IconAlertCircle size={16} className="shrink-0 text-amber-600" />
            <span>
              Metrik ini menggabungkan <strong>{d.families.join(' dan ')}</strong>. Bulan laporan hanya dianggap
              lengkap dan dihitung bila <strong>kedua</strong> jenis laporan tersebut telah tersedia.
            </span>
          </div>
        )}
      </div>

      {/* Matriks Kelengkapan Rentang 1 Tahun dengan Filter Tahunan */}
      {coverage?.units?.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Matriks Kelengkapan Laporan (1 Tahun)
                </h4>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-mono">
                  Tahun {selectedYear}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Memetakan ketersediaan laporan tiap ULP per bulan (Jan–Des). Kotak merah menandai laporan yang belum masuk.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Filter Pilihan Tahun */}
              <div className="flex items-center gap-1.5">
                <label htmlFor="coverage-year-select" className="text-xs text-slate-500 font-medium">
                  Tahun:
                </label>
                <select
                  id="coverage-year-select"
                  aria-label="Filter Tahun Matriks Kelengkapan"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-2xs focus-ring cursor-pointer"
                >
                  {availableYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              {totalMissingYear > 0 ? (
                <span className="text-xs font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-0.5 rounded-full border border-rose-200 dark:border-rose-800">
                  {totalMissingYear} kekurangan
                </span>
              ) : (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                  Lengkap 100%
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                  <th className="py-2 pr-3 text-left font-semibold sticky left-0 bg-white dark:bg-slate-900 z-10 w-44">
                    Unit ULP
                  </th>
                  {yearMonths.map((ym, i) => (
                    <th key={ym} className="px-1 py-1.5 text-center font-mono text-[10px] w-10">
                      {MONTH_NAMES_SHORT[i]}
                    </th>
                  ))}
                  <th className="py-2 pl-2 text-right font-semibold w-16">Kurang</th>
                </tr>
              </thead>
              <tbody>
                {yearCoverageUnits.map((u) => (
                  <tr key={u.unit_id} className="border-b border-slate-50 dark:border-slate-800/60 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-900 z-10">
                      {u.unit_name}
                    </td>
                    {u.months.map((has, i) => (
                      <td key={yearMonths[i]} className="p-1 text-center">
                        <span
                          title={`${u.unit_name} - ${yearMonths[i]}: ${has ? 'Lengkap' : 'Belum Ada'}`}
                          className={`inline-block w-4 h-4 rounded-xs transition-transform hover:scale-125 cursor-default ${
                            has
                              ? 'bg-emerald-500'
                              : 'bg-rose-400 dark:bg-rose-600 opacity-80'
                          }`}
                        />
                      </td>
                    ))}
                    <td className="py-2 pl-2 text-right font-mono font-semibold">
                      {u.missing_count > 0 ? (
                        <span className="text-rose-600">{u.missing_count}</span>
                      ) : (
                        <span className="text-emerald-600">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Riwayat Sesi Sinkronisasi (syncs) dengan Pagination */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Sesi Penarikan Sinkronisasi Terkait
            </h4>
            <p className="text-[11px] text-slate-500">
              Riwayat penarikan otomatis atau manual yang relevan dengan metrik ini.
            </p>
          </div>
          {Array.isArray(syncs) && syncs.length > 0 && (
            <span className="text-xs font-medium text-slate-500">
              Total {syncs.length} sesi
            </span>
          )}
        </div>

        {syncs === null ? (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <IconLock size={16} />
            <span>Tidak berwenang melihat riwayat sesi sinkronisasi.</span>
          </div>
        ) : syncs.length === 0 ? (
          <p className="text-center py-4 text-xs text-slate-400">
            Tidak ada sesi sinkronisasi daring untuk sumber laporan ini (data diunggah dari berkas Excel/laporan).
          </p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-left">
                    <th className="py-2 pr-2">Waktu</th>
                    <th className="py-2 pr-2">Sumber</th>
                    <th className="py-2 pr-2">Jenis / Pemicu</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2">Hasil</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                  {paginatedSyncs.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2 pr-2 whitespace-nowrap">{fmtDate(s.created_at)}</td>
                      <td className="py-2 pr-2 font-mono text-[11px]">{s.source}</td>
                      <td className="py-2 pr-2">
                        {s.kind || '-'} ({s.trigger})
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                            s.status === 'OK'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : s.status === 'RUNNING'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-2 text-slate-600 dark:text-slate-300">
                        {s.message || (s.counts ? `${fmtInt(s.counts.read ?? 0)} baris` : '-')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Sesi Sinkronisasi */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <Pagination
                page={syncsPage}
                total={syncs.length}
                perPage={syncsPerPage}
                onPage={setSyncsPage}
                onPerPage={(pp) => {
                  setSyncsPerPage(pp)
                  setSyncsPage(1)
                }}
                perPageOptions={[5, 10, 20]}
              />
            </div>
          </div>
        )}
      </div>

      {/* Daftar Berkas Laporan Diimpor Terbaru (files) dengan Pagination */}
      {files.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Berkas Laporan Terdaftar Terbaru
              </h4>
              <p className="text-[11px] text-slate-500">
                Daftar berkas laporan bulanan yang berhasil diproses ke dalam database.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-500">
              Total {files.length} berkas
            </span>
          </div>

          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-left">
                    <th className="py-2 pr-2">Bulan</th>
                    <th className="py-2 pr-2">Unit</th>
                    <th className="py-2 pr-2">Nama Berkas</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2 text-right">Baris</th>
                    <th className="py-2">Waktu Impor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                  {paginatedFiles.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2 pr-2 font-mono font-medium">{monthLabel(f.period)}</td>
                      <td className="py-2 pr-2">{f.unit_name}</td>
                      <td className="py-2 pr-2 font-mono text-[11px] truncate max-w-xs" title={f.original_name}>
                        {f.original_name}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                            f.status === 'AKTIF'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {f.status}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmtInt(f.line_count ?? 0)}</td>
                      <td className="py-2 text-slate-500">{fmtDate(f.imported_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Berkas Laporan */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <Pagination
                page={filesPage}
                total={files.length}
                perPage={filesPerPage}
                onPage={setFilesPage}
                onPerPage={(pp) => {
                  setFilesPerPage(pp)
                  setFilesPage(1)
                }}
                perPageOptions={[5, 10, 25, 50]}
              />
            </div>
          </div>
        </div>
      )}

      {/* Riwayat Masukan Bulanan (hanya untuk metrik Susut) dengan Pagination */}
      {inputs.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Riwayat Perubahan Masukan Bulanan (kWh Beli)
              </h4>
              <p className="text-[11px] text-slate-500">
                Catatan riwayat masukan angka beli, E-Min, dan PSSD.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-500">
              Total {inputs.length} masukan
            </span>
          </div>

          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-left">
                    <th className="py-2 pr-2">Periode</th>
                    <th className="py-2 pr-2">Unit</th>
                    <th className="py-2 pr-2">Kode</th>
                    <th className="py-2 pr-2 text-right">Nilai (kWh)</th>
                    <th className="py-2 pr-2">Catatan</th>
                    <th className="py-2">Diperbarui</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                  {paginatedInputs.map((inp, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2 pr-2 font-mono">{monthLabel(inp.period)}</td>
                      <td className="py-2 pr-2">{inp.unit_name}</td>
                      <td className="py-2 pr-2 font-mono text-[11px]">{inp.code}</td>
                      <td className="py-2 pr-2 text-right tabular-nums font-mono">{fmtInt(inp.value)}</td>
                      <td className="py-2 pr-2 text-slate-500">{inp.note || '-'}</td>
                      <td className="py-2 text-slate-500">{fmtDate(inp.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Riwayat Masukan */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <Pagination
                page={inputsPage}
                total={inputs.length}
                perPage={inputsPerPage}
                onPage={setInputsPage}
                onPerPage={(pp) => {
                  setInputsPerPage(pp)
                  setInputsPage(1)
                }}
                perPageOptions={[5, 10, 20]}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
