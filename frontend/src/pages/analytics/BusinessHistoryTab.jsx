import { useEffect, useState } from 'react'
import { pengusahaanApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
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

/**
 * Tab Histori Sinkronisasi & Kelengkapan Sumber Data (docs/91 §3c, Butir 14 & 15):
 * - Matriks kelengkapan 24 bulan per ULP (coverage)
 * - Daftar berkas impor laporan terbaru (files)
 * - Riwayat masukan kWh beli (inputs, untuk susut)
 * - Riwayat sesi penarikan sinkronisasi (syncs: permohonan/piutang/gangguan)
 */
export default function BusinessHistoryTab({ metricCode, unitId }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })

  useEffect(() => {
    let alive = true
    setState({ loading: true, error: '', data: null })

    pengusahaanApi
      .history(metricCode, { unit_id: unitId || undefined })
      .then((res) => {
        if (!alive) return
        setState({ loading: false, error: '', data: res?.data || null })
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

  const d = state.data
  if (!d) return null

  const coverage = d.coverage
  const months = d.months || []
  const files = d.files || []
  const inputs = d.inputs || []
  const syncs = d.syncs
  const families = d.families || (d.family ? [d.family] : [])

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

      {/* Matriks Kelengkapan ULP x 24 Bulan (Coverage) */}
      {coverage?.units?.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Matriks Kelengkapan 24 Bulan Terakhir
              </h4>
              <p className="text-[11px] text-slate-500">
                Memetakan ketersediaan laporan tiap ULP per bulan. Kotak merah menandai bulan yang belum masuk.
              </p>
            </div>
            {coverage.missing_total > 0 && (
              <span className="text-xs font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-0.5 rounded-full border border-rose-200 dark:border-rose-800">
                {coverage.missing_total} kekurangan
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                  <th className="py-2 pr-3 text-left font-semibold sticky left-0 bg-white dark:bg-slate-900">
                    Unit ULP
                  </th>
                  {months.map((m) => (
                    <th key={m} className="px-1 py-1.5 text-center font-mono text-[10px]">
                      {monthLabel(m).slice(0, 3)}
                    </th>
                  ))}
                  <th className="py-2 pl-2 text-right font-semibold">Kurang</th>
                </tr>
              </thead>
              <tbody>
                {coverage.units.map((u) => (
                  <tr key={u.unit_id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-900">
                      {u.unit_name}
                    </td>
                    {u.months?.map((has, i) => (
                      <td key={months[i] || i} className="p-1 text-center">
                        <span
                          title={`${u.unit_name} - ${months[i]}: ${has ? 'Lengkap' : 'Belum Ada'}`}
                          className={`inline-block w-4 h-4 rounded-xs ${
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

      {/* Riwayat Sesi Sinkronisasi (syncs) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
        <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Sesi Penarikan Sinkronisasi Terkait
          </h4>
          <p className="text-[11px] text-slate-500">
            Riwayat penarikan otomatis atau manual yang relevan dengan metrik ini.
          </p>
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
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-left">
                  <th className="py-1.5 pr-2">Waktu</th>
                  <th className="py-1.5 pr-2">Sumber</th>
                  <th className="py-1.5 pr-2">Jenis / Pemicu</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {syncs.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(s.created_at)}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{s.source}</td>
                    <td className="py-1.5 pr-2">
                      {s.kind || '-'} ({s.trigger})
                    </td>
                    <td className="py-1.5 pr-2">
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
                    <td className="py-1.5 text-slate-600 dark:text-slate-300">
                      {s.message || (s.counts ? `${fmtInt(s.counts.read ?? 0)} baris` : '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Daftar Berkas Laporan Diimpor Terbaru (files) */}
      {files.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Berkas Laporan Terdaftar Terbaru (Maks. 100)
            </h4>
            <p className="text-[11px] text-slate-500">
              Daftar berkas laporan bulanan yang berhasil diproses ke dalam database.
            </p>
          </div>

          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-left">
                  <th className="py-1.5 pr-2">Bulan</th>
                  <th className="py-1.5 pr-2">Unit</th>
                  <th className="py-1.5 pr-2">Nama Berkas</th>
                  <th className="py-1.5 pr-2">Status</th>
                  <th className="py-1.5 pr-2 text-right">Baris</th>
                  <th className="py-1.5">Waktu Impor</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-1.5 pr-2 font-mono font-medium">{monthLabel(f.period)}</td>
                    <td className="py-1.5 pr-2">{f.unit_name}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] truncate max-w-xs" title={f.original_name}>
                      {f.original_name}
                    </td>
                    <td className="py-1.5 pr-2">
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
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmtInt(f.line_count ?? 0)}</td>
                    <td className="py-1.5 text-slate-500">{fmtDate(f.imported_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Riwayat Masukan Bulanan (hanya untuk metrik Susut) */}
      {inputs.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Riwayat Perubahan Masukan Bulanan (kWh Beli)
            </h4>
          </div>

          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-left">
                  <th className="py-1.5 pr-2">Periode</th>
                  <th className="py-1.5 pr-2">Unit</th>
                  <th className="py-1.5 pr-2">Kode</th>
                  <th className="py-1.5 pr-2 text-right">Nilai (kWh)</th>
                  <th className="py-1.5 pr-2">Catatan</th>
                  <th className="py-1.5">Diperbarui</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((inp, idx) => (
                  <tr key={idx} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-1.5 pr-2 font-mono">{monthLabel(inp.period)}</td>
                    <td className="py-1.5 pr-2">{inp.unit_name}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{inp.code}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-mono">{fmtInt(inp.value)}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{inp.note || '-'}</td>
                    <td className="py-1.5 text-slate-500">{fmtDate(inp.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
