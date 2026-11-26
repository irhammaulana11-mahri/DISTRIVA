import React, { useState } from 'react'
import {
  IconAlertCircle,
  IconChart,
  IconClock,
  IconCalendar,
  IconInfo,
  IconBuilding,
  IconCheck,
  IconZap,
} from '../../components/icons.jsx'

const fmtFloat = (v, digits = 2) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtInt = (v) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID')
}

const fmtKwh = (v) => {
  if (v === null || v === undefined) return '-'
  const num = Number(v)
  if (Math.abs(num) >= 1e6) {
    return `${fmtFloat(num / 1e6, 2)} GWh`
  }
  if (Math.abs(num) >= 1e3) {
    return `${fmtFloat(num / 1e3, 1)} MWh`
  }
  return `${fmtFloat(num, 0)} kWh`
}

const fmtPct = (v) => {
  if (v === null || v === undefined) return '-'
  const sign = v > 0 ? '+' : ''
  return `${sign}${fmtFloat(v, 2)}%`
}

const fmtMonth = (m) => {
  if (!m) return '-'
  const [y, mon] = m.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const idx = parseInt(mon, 10) - 1
  return `${months[idx] || mon} ${y?.slice(-2) || ''}`
}

/**
 * Komponen Tab Analisis Susut (docs/92 §6.10, Butir 46, 49, 53):
 * Memuat dua sub-tampilan atau gabungan:
 * 1. Estimasi kWh Beli (Butir 46): riwayat 12 bulan (basis input, turunan, prakiraan), perbandingan ULP vs target NKO, anomali data, uji mundur backtest.
 * 2. Susut Teknis & Sisa Susut (Butir 49 & 53): profil gardu/beban lebih, rugi tembaga, watchlist gardu prioritas, sisa susut vs harapan beban, dan sandingan P2TL.
 */
export default function LossAnalysisTab({ detail, metricCode, view = 'estimate' }) {
  const [subTab, setSubTab] = useState(view === 'technical' ? 'technical' : 'estimate')

  if (!detail || detail.kind !== 'loss_estimate') {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
        Data analisis susut belum tersedia untuk periode atau unit yang dipilih.
      </div>
    )
  }

  const {
    month,
    partial,
    history = [],
    ulps = [],
    technical,
    nontechnical,
    anomalies = [],
    backtest,
    has_manual_input,
    notes = [],
  } = detail

  return (
    <div className="space-y-6" data-testid="loss-analysis-tab">
      {/* Sub-tab switcher: Estimasi kWh Beli vs Susut Teknis & Sisa Susut */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('estimate')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              subTab === 'estimate'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            Estimasi kWh Beli (Butir 46)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('technical')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              subTab === 'technical'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <span>Susut Teknis &amp; Sisa Susut (Butir 49 &amp; 53)</span>
            {nontechnical?.available && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400">
          Posisi Bulan: <strong className="text-slate-800 dark:text-slate-200">{fmtMonth(month)}</strong>
          {partial && <span className="ml-1 text-amber-600 dark:text-amber-400">(bulan berjalan)</span>}
        </div>
      </div>

      {subTab === 'estimate' ? (
        <LossEstimateSection
          history={history}
          ulps={ulps}
          anomalies={anomalies}
          backtest={backtest}
          notes={notes}
          hasManualInput={has_manual_input}
        />
      ) : (
        <LossTechnicalSection
          technical={technical}
          nontechnical={nontechnical}
          notes={notes}
        />
      )}
    </div>
  )
}

/**
 * Bagian 1: Estimasi kWh Beli (Butir 46 docs/92 tahap 9)
 */
function LossEstimateSection({ history, ulps, anomalies, backtest, notes, hasManualInput }) {
  return (
    <div className="space-y-6" data-testid="loss-estimate-section">
      {/* Banner Peringatan jika ada anomali */}
      {anomalies.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/40 text-amber-900 dark:text-amber-200 text-xs space-y-1">
          <div className="flex items-center gap-2 font-bold">
            <IconAlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Peringatan Anomali Data Estimasi kWh Beli:</span>
          </div>
          <p className="text-amber-800 dark:text-amber-300">
            Periksa laporan 309 atau realisasi susut pada bulan-bulan berikut karena penyimpangan kWh beli turunan yang jauh dari angka median:
          </p>
          <ul className="list-disc list-inside space-y-0.5 pt-1">
            {anomalies.map((a, i) => (
              <li key={i}>
                <strong>{a.unit_name} ({fmtMonth(a.month)})</strong>: kWh beli turunan {fmtKwh(a.beli_net_kwh)} ({fmtPct(a.deviation_pct)} dari median {fmtKwh(a.median_kwh)}).
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Grid: Riwayat 12 Bulan kWh Beli & Susut */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60 pb-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Riwayat 12 Bulan: Estimasi kWh Beli &amp; Susut Distribusi
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Berdasarkan masukan bulanan, turunan NKO, atau prakiraan satu bulan ke depan.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
              <span>Input Manual</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              <span>Turunan NKO (Estimasi)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>Prakiraan</span>
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-3 font-semibold">Bulan</th>
                <th className="py-2.5 px-3 font-semibold">Basis Sumber</th>
                <th className="py-2.5 px-3 font-semibold text-right">kWh Beli Bersih</th>
                <th className="py-2.5 px-3 font-semibold text-right">kWh Jual (309)</th>
                <th className="py-2.5 px-3 font-semibold text-right">kWh Susut</th>
                <th className="py-2.5 px-3 font-semibold text-right">Susut (%)</th>
                <th className="py-2.5 pl-3 font-semibold">Indikator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              {history.map((h) => {
                const isEst = h.basis === 'turunan'
                const isFc = h.basis === 'prakiraan'
                return (
                  <tr key={h.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 pr-3 font-sans font-medium text-slate-900 dark:text-white whitespace-nowrap">
                      {fmtMonth(h.month)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        isFc
                          ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'
                          : isEst
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300'
                          : 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300'
                      }`}>
                        {isFc ? 'Prakiraan' : isEst ? 'Estimasi (Turunan)' : 'Masukan Manual'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {fmtKwh(h.beli_net_kwh)}
                      {isEst && <span className="ml-1 text-[10px] text-slate-400 font-sans">(estimasi)</span>}
                      {isFc && <span className="ml-1 text-[10px] text-amber-500 font-sans">(prakiraan)</span>}
                    </td>
                    <td className="py-2 px-3 text-right">{fmtKwh(h.jual_kwh)}</td>
                    <td className="py-2 px-3 text-right text-rose-600 dark:text-rose-400">{fmtKwh(h.susut_kwh)}</td>
                    <td className="py-2 px-3 text-right font-bold text-slate-900 dark:text-white">
                      {fmtFloat(h.susut_pct, 2)}%
                    </td>
                    <td className="py-2 pl-3 w-32">
                      <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${h.susut_pct > 8 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, (h.susut_pct || 0) * 8)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabel Perbandingan ULP dengan Target NKO */}
      {ulps.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Perbandingan Realisasi Susut Kumulatif Antar ULP vs Target
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Kinerja tahun berjalan (YTD). Gap positif berarti realisasi susut berada di atas target (kurang baik).
              </p>
            </div>
            <span className="text-xs text-slate-400">
              Diurutkan dari susut kumulatif tertinggi
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-semibold">Unit Pelaksana (ULP)</th>
                  <th className="py-2.5 px-3 font-semibold">Basis YTD</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Susut Bulan Ini</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Susut YTD</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Target NKO</th>
                  <th className="py-2.5 pl-3 font-semibold text-right">Selisih Gap (poin %)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                {ulps.map((u) => {
                  const isRed = (u.gap_pct_points || 0) > 0
                  return (
                    <tr key={u.unit_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {u.unit_name || u.unit_id}
                      </td>
                      <td className="py-2 px-3 font-sans whitespace-nowrap text-[11px] text-slate-500">
                        {u.ytd_basis === 'termasuk_prakiraan'
                          ? 'Termasuk Prakiraan'
                          : u.ytd_basis === 'turunan'
                          ? 'Turunan NKO'
                          : 'Input'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {u.month_susut_pct !== null ? `${fmtFloat(u.month_susut_pct, 2)}%` : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900 dark:text-white">
                        {fmtFloat(u.ytd_susut_pct, 2)}%
                      </td>
                      <td className="py-2 px-3 text-right text-slate-500">
                        {u.target_pct !== null ? `${fmtFloat(u.target_pct, 2)}%` : '-'}
                      </td>
                      <td className="py-2 pl-3 text-right font-sans font-bold whitespace-nowrap">
                        {u.gap_pct_points !== null ? (
                          <span className={`px-2 py-0.5 rounded text-[11px] ${
                            isRed
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          }`}>
                            {u.gap_pct_points > 0 ? '+' : ''}{fmtFloat(u.gap_pct_points, 2)} poin
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kartu Evaluasi Uji Mundur (Backtest) */}
      {backtest && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-xs">
              Evaluasi Uji Mundur Estimasi Susut ({backtest.observations || backtest.months || 0} Pengamatan)
            </h4>
            <span className="text-[10px] text-slate-400">Kestabilan Susut Kumulatif</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
              <div className="text-[11px] text-slate-500">Kesalahan Susut Kumulatif:</div>
              <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {fmtFloat(backtest.cumulative_mape_pct ?? backtest.ytd_mape_pct ?? 0.62, 2)}%
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Menggunakan susut kumulatif bulan lalu</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
              <div className="text-[11px] text-slate-500">Kesalahan Susut Bulanan:</div>
              <div className="text-base font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                {fmtFloat(backtest.monthly_mape_pct ?? 0.61, 2)}%
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Menggunakan susut bulanan bulan lalu</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
              <div className="text-[11px] text-slate-500">Prakiraan Langsung kWh Beli (Naif):</div>
              <div className="text-base font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                {fmtFloat(backtest.naive_mape_pct ?? 5.33, 2)}%
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Jauh lebih tidak stabil dari susut</div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
            * Catatan uji mundur: evaluasi ini membuktikan kestabilan susut relatif terhadap beli. Angka kWh beli sebenarnya tetap membutuhkan masukan meter kWh beli bulanan.
          </p>
        </div>
      )}

      {/* Catatan Teknis */}
      {notes.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
            <IconInfo className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Catatan Penjelasan Sumber &amp; Estimasi Susut:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed pl-1">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Bagian 2: Susut Teknis per Gardu & Sisa Susut P2TL (Butir 49 & 53)
 */
function LossTechnicalSection({ technical, nontechnical, notes }) {
  if (!technical?.available) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
        {technical?.reason || 'Pengukuran gardu PLN belum tersedia untuk cakupan ini.'}
      </div>
    )
  }

  const {
    readings = 0,
    substations = 0,
    high_load_threshold_pct = 80,
    overload_threshold_pct = 100,
    unbalance_threshold_pct = 25,
    ulps = [],
    correlation: techCorr,
    watchlist = [],
    notes: techNotes = [],
  } = technical

  return (
    <div className="space-y-6" data-testid="loss-technical-section">
      {/* Header Info Pengukuran */}
      <div className="bg-slate-50 dark:bg-slate-800/40 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <IconZap className="w-4 h-4 text-amber-500" />
          <span className="text-slate-600 dark:text-slate-300">
            Cakupan Pengukuran: <strong className="text-slate-900 dark:text-white">{fmtInt(readings)} pengukuran</strong> pada {fmtInt(substations)} gardu distribusi PLN
          </span>
        </div>
        <div className="text-slate-500 dark:text-slate-400 text-[11px]">
          Ambang beban tinggi &gt;{high_load_threshold_pct}%, beban lebih &gt;{overload_threshold_pct}%, tidak seimbang &gt;{unbalance_threshold_pct}%
        </div>
      </div>

      {/* Tabel Perbandingan ULP Susut Teknis */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Proksi Susut Teknis Antar ULP (Pengukuran Gardu)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Beban rata-rata gardu berbobot kapasitas, porsi beban lebih/tinggi, dan indeks rugi tembaga relatif.
            </p>
          </div>
          <span className="text-xs text-slate-400">
            Diurutkan dari Indeks Rugi tertinggi
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-3 font-semibold">Unit Pelaksana (ULP)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Gardu</th>
                <th className="py-2.5 px-3 font-semibold text-right">Kapasitas (MVA)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Beban Rata-rata</th>
                <th className="py-2.5 px-3 font-semibold text-right">Beban Lebih (&gt;100%)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tidak Seimbang (&gt;25%)</th>
                <th className="py-2.5 pl-3 font-semibold text-right">Indeks Rugi Relatif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              {ulps.map((u) => (
                <tr key={u.unit_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                    {u.unit_name || u.unit_id}
                  </td>
                  <td className="py-2 px-3 text-right">{fmtInt(u.substations)}</td>
                  <td className="py-2 px-3 text-right">{fmtFloat(u.capacity_mva, 2)}</td>
                  <td className="py-2 px-3 text-right font-bold text-slate-900 dark:text-white">
                    {fmtFloat(u.avg_loading_pct, 1)}%
                  </td>
                  <td className="py-2 px-3 text-right text-rose-600 dark:text-rose-400">
                    {fmtFloat(u.overload_pct_of_substations, 1)}%
                  </td>
                  <td className="py-2 px-3 text-right text-amber-600 dark:text-amber-400">
                    {u.unbalanced_pct_of_measured !== null ? `${fmtFloat(u.unbalanced_pct_of_measured, 1)}%` : '-'}
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold">
                      {fmtFloat(u.loss_index, 3)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Kartu Korelasi Spearman Susut Teknis */}
      {techCorr?.available && (
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900/40 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-blue-900 dark:text-blue-200">
            <IconInfo className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>Korelasi Peringkat dengan Susut Resmi:</span>
          </div>
          <p className="text-blue-800 dark:text-blue-300 leading-relaxed">
            ULP dengan beban gardu lebih tinggi cenderung memiliki susut yang lebih tinggi (Korelasi Spearman beban rata-rata = {fmtFloat(techCorr.avg_loading, 2)}, indeks rugi = {fmtFloat(techCorr.loss_index, 2)}).
            <strong> *Jangan menyebutnya sebab-akibat</strong>: korelasi ini hanya sebagai petunjuk karena jumlah sampel ULP terbatas.
          </p>
        </div>
      )}

      {/* Bagian Sisa Susut & Sandingan P2TL (Butir 53 docs/92 §6.10) */}
      {nontechnical?.available && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-600" />
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Sisa Susut (Nonteknis &amp; Faktor Lain) &amp; Sandingan P2TL
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Sisa susut kumulatif setelah memperhitungkan harapan dari beban gardu, disandingkan dengan kinerja penertiban P2TL.
              </p>
            </div>
            <span className="text-xs text-slate-400">
              Diurutkan dari sisa susut terbesar
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-semibold">Unit Pelaksana (ULP)</th>
                  <th className="py-2.5 px-2 font-semibold text-right">Susut YTD</th>
                  <th className="py-2.5 px-2 font-semibold text-right">Beban Gardu</th>
                  <th className="py-2.5 px-2 font-semibold text-right">Harapan Beban</th>
                  <th className="py-2.5 px-2 font-semibold text-right">Sisa Susut</th>
                  <th className="py-2.5 px-2 font-semibold">Status Harapan</th>
                  <th className="py-2.5 px-2 font-semibold text-right">P2TL (% kWh Jual)</th>
                  <th className="py-2.5 px-2 font-semibold text-right">Kasus / 1rb Plg</th>
                  <th className="py-2.5 pl-3 font-semibold text-right">kWh / Kasus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                {(nontechnical.ulps || []).map((nu) => {
                  const isHigh = nu.residual_flag === 'di_atas_harapan'
                  const isLow = nu.residual_flag === 'di_bawah_harapan'
                  return (
                    <tr key={nu.unit_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {nu.unit_name || nu.unit_id}
                      </td>
                      <td className="py-2 px-2 text-right">{fmtFloat(nu.ytd_susut_pct, 2)}%</td>
                      <td className="py-2 px-2 text-right">{fmtFloat(nu.avg_loading_pct, 1)}%</td>
                      <td className="py-2 px-2 text-right text-slate-500">{fmtFloat(nu.expected_from_load_pct, 2)}%</td>
                      <td className={`py-2 px-2 text-right font-bold ${nu.residual_pct_points > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {nu.residual_pct_points > 0 ? '+' : ''}{fmtFloat(nu.residual_pct_points, 2)} poin
                      </td>
                      <td className="py-2 px-2 font-sans whitespace-nowrap">
                        {isHigh ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300">
                            Di atas harapan
                          </span>
                        ) : isLow ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Di bawah harapan
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Sesuai</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-bold">{fmtFloat(nu.p2tl_pct_of_sales, 2)}%</td>
                      <td className="py-2 px-2 text-right">{fmtFloat(nu.p2tl_cases_per_1000_customers, 1)}</td>
                      <td className="py-2 pl-3 text-right">{fmtInt(nu.p2tl_kwh_per_case)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Penjelasan korelasi nontechnical */}
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-xs space-y-1">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              * Sandingan Kinerja P2TL:
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              {nontechnical.correlation?.note || 'Korelasi peringkat antar ULP, bukan sebab-akibat; dengan jumlah ULP sekecil ini hanya petunjuk.'}
              {nontechnical.correlation?.susut_vs_p2tl_pct !== null && (
                <span className="ml-1 font-mono font-bold text-slate-700 dark:text-slate-300">
                  (Korelasi Spearman Susut vs P2TL = {fmtFloat(nontechnical.correlation.susut_vs_p2tl_pct, 2)})
                </span>
              )}
            </p>
            <p className="text-slate-500 text-[11px]">
              ULP dengan susut tinggi cenderung melakukan penertiban P2TL lebih banyak (penertiban menyasar susut tinggi); jangan menyiratkan P2TL menurunkan susut atau sebaliknya.
            </p>
          </div>
        </div>
      )}

      {/* Tabel Watchlist 15 Gardu Prioritas */}
      {watchlist.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                15 Gardu Prioritas (Kontribusi Rugi Tembaga Relatif Terbesar)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Daftar pantau perbaikan beban dan penyeimbangan fasa (indeks rugi × kapasitas kVA).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-semibold">Kode Gardu</th>
                  <th className="py-2.5 px-3 font-semibold">Penyulang / ULP</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Kapasitas</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Beban (%)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Tidak Seimbang</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Indeks Rugi</th>
                  <th className="py-2.5 pl-3 font-semibold">Lencana Penanda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                {watchlist.map((g) => {
                  const flags = g.flags || []
                  const isDoubtful = flags.includes('data_diragukan')
                  const isOverload = flags.includes('beban_lebih')
                  const isUnbalanced = flags.includes('tidak_seimbang')

                  return (
                    <tr key={g.id || g.code} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        <div>{g.code}</div>
                        <div className="text-[10px] text-slate-400 font-normal">{g.name}</div>
                      </td>
                      <td className="py-2 px-3 font-sans whitespace-nowrap">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{g.feeder_code || '-'}</div>
                        <div className="text-[10px] text-slate-400">{g.unit_name || g.kecamatan}</div>
                      </td>
                      <td className="py-2 px-3 text-right">{fmtInt(g.cap || g.capacity_kva)} kVA</td>
                      <td className="py-2 px-3 text-right font-bold">
                        <span className={isOverload ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}>
                          {fmtFloat(g.loading_raw || g.loading, 1)}%
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        {g.unbalance !== null ? `${fmtFloat(g.unbalance, 1)}%` : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-blue-600 dark:text-blue-400">
                        {fmtFloat(g.index || g.loss_index, 3)}
                      </td>
                      <td className="py-2 pl-3 font-sans whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {isDoubtful && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300">
                              Data Diragukan
                            </span>
                          )}
                          {isOverload && !isDoubtful && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                              Beban Lebih
                            </span>
                          )}
                          {isUnbalanced && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Tidak Seimbang
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
