import React, { useMemo } from 'react'

/**
 * Tab Perbandingan ULP untuk RPT-RCT Gangguan dan Keluhan (docs/91 §3, docs/92 §6.7, Butir 42).
 *
 * Menampilkan:
 * (a) Tabel perbandingan ULP bulan terpilih dengan WO, RPT, RCT, peringkat, dan jarak ke terbaik (gap to peer best)
 *     pada volume WO sebanding. Khusus gangguan: kolom tanpa clear temper (NCT), porsi clear temper,
 *     dan penjelas bahwa peringkat memakai laporan tanpa clear temper (NKO).
 * (b) Grafik riwayat 12 bulan (batang WO + garis tren RPT dan RCT).
 * (c) Kartu "Volume dan waktu tanggap" dari volume_effect (reading & 2 korelasi), disembunyikan bila available: false.
 * (d) Peringatan data parsial jika bulan berjalan belum utuh.
 * (e) Catatan teknis dari notes[].
 */
export default function ResponseComparisonTab({ detail, metricCode }) {
  if (!detail || detail.kind !== 'response') {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
        Data wawasan waktu tanggap belum tersedia untuk metrik ini.
      </div>
    )
  }

  const {
    focus,
    unit = 'menit',
    month,
    partial = false,
    basis = 'tanpa_clear_temper',
    ulps = [],
    history = [],
    volume_effect: volumeEffect,
    notes = [],
  } = detail

  const isGangguan = metricCode === 'rpt-rct-gangguan' || focus === 'rpt-rct-gangguan'

  // Hitung ringkasan skala untuk grafik riwayat 12 bulan
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return null

    const maxWo = Math.max(...history.map((h) => h.wo || 0), 1)
    const maxRpt = Math.max(...history.map((h) => (isGangguan ? (h.rpt_nct ?? h.rpt ?? 0) : (h.rpt ?? 0))), 1)
    const maxRct = Math.max(...history.map((h) => (isGangguan ? (h.rct_nct ?? h.rct ?? 0) : (h.rct ?? 0))), 1)
    const maxTime = Math.max(maxRpt, maxRct, 1) * 1.15

    return { maxWo, maxTime, items: history }
  }, [history, isGangguan])

  return (
    <div className="space-y-6">
      {/* Header Info & Partial Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
              Perbandingan Waktu Tanggap
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Bulan: <strong className="text-slate-700 dark:text-slate-200">{month}</strong>
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Satuan: <strong className="text-slate-700 dark:text-slate-200">{unit}</strong>
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {isGangguan
              ? 'Peringkat dan jarak ke ULP terbaik dihitung berdasarkan laporan tanpa clear temper (sesuai indikator NKO).'
              : 'Peringkat dan jarak dihitung terhadap ULP tercepat dengan volume WO sebanding (0,5× hingga 2,0×).'}
          </p>
        </div>

        {partial && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-medium">
            <svg className="w-4 h-4 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Bulan berjalan belum lengkap (data bertambah)</span>
          </div>
        )}
      </div>

      {/* Kartu Volume dan Waktu Tanggap (docs/92 §6.7) */}
      {volumeEffect && volumeEffect.available !== false && (
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Volume dan Waktu Tanggap (Korelasi Dalam-ULP)
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {volumeEffect.observations || 0} pengamatan ({volumeEffect.ulps || 0} ULP)
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {volumeEffect.reading}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                * Korelasi Pearson dalam ULP yang sama pada bulan lengkap; bukan hubungan sebab-akibat.
              </p>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Korelasi WO vs RPT</div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {volumeEffect.rpt_correlation !== null && volumeEffect.rpt_correlation !== undefined
                    ? volumeEffect.rpt_correlation > 0
                      ? `+${volumeEffect.rpt_correlation.toFixed(3)}`
                      : volumeEffect.rpt_correlation.toFixed(3)
                    : '-'}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Korelasi WO vs RCT</div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {volumeEffect.rct_correlation !== null && volumeEffect.rct_correlation !== undefined
                    ? volumeEffect.rct_correlation > 0
                      ? `+${volumeEffect.rct_correlation.toFixed(3)}`
                      : volumeEffect.rct_correlation.toFixed(3)
                    : '-'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabel Perbandingan ULP */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Perbandingan Waktu Tanggap Antar ULP ({month})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isGangguan
                ? 'Peringkat & jarak ke terbaik memakai laporan tanpa clear temper (NCT); kolom semua laporan disertakan sebagai pembanding.'
                : 'Peringkat dan selisih terhadap ULP tercepat dengan volume WO sebanding.'}
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {ulps.length} ULP terdaftar
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold">ULP</th>
                <th className="py-2.5 px-3 font-semibold text-right">Volume WO</th>
                {isGangguan && (
                  <>
                    <th className="py-2.5 px-3 font-semibold text-right">WO (Tanpa CT)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Porsi CT (%)</th>
                  </>
                )}
                <th className="py-2.5 px-3 font-semibold text-right">
                  {isGangguan ? `RPT NCT (${unit})` : `RPT (${unit})`}
                </th>
                <th className="py-2.5 px-3 font-semibold text-center">Peringkat RPT</th>
                <th className="py-2.5 px-3 font-semibold text-right">Jarak RPT Terbaik</th>
                <th className="py-2.5 px-3 font-semibold text-right">
                  {isGangguan ? `RCT NCT (${unit})` : `RCT (${unit})`}
                </th>
                <th className="py-2.5 px-3 font-semibold text-center">Peringkat RCT</th>
                <th className="py-2.5 px-3 font-semibold text-right">Jarak RCT Terbaik</th>
                {isGangguan && (
                  <>
                    <th className="py-2.5 px-3 font-semibold text-right text-slate-400">RPT Semua ({unit})</th>
                    <th className="py-2.5 px-3 font-semibold text-right text-slate-400">RCT Semua ({unit})</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ulps.length === 0 ? (
                <tr>
                  <td colSpan={isGangguan ? 11 : 7} className="py-8 text-center text-slate-400">
                    Tidak ada data waktu tanggap ULP untuk bulan ini.
                  </td>
                </tr>
              ) : (
                ulps.map((u) => {
                  const rptVal = isGangguan ? u.rpt_nct : u.rpt
                  const rctVal = isGangguan ? u.rct_nct : u.rct
                  return (
                    <tr key={u.unit_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                        {u.unit_name}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                        {u.wo?.toLocaleString('id-ID')}
                      </td>
                      {isGangguan && (
                        <>
                          <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                            {u.wo_nct !== undefined ? u.wo_nct.toLocaleString('id-ID') : '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                            {u.clear_temper_share_pct !== null && u.clear_temper_share_pct !== undefined
                              ? `${u.clear_temper_share_pct.toFixed(1)}%`
                              : '-'}
                          </td>
                        </>
                      )}
                      <td className="py-2 px-3 text-right font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {rptVal !== null && rptVal !== undefined ? rptVal.toFixed(unit === 'jam' ? 2 : 1) : '-'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          #{u.rpt_rank || '-'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {u.peer_count === 0 || u.rpt_gap_to_peer_best === null || u.rpt_gap_to_peer_best === undefined ? (
                          <span className="text-slate-400">-</span>
                        ) : u.rpt_gap_to_peer_best === 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Terbaik</span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-300">
                            +{u.rpt_gap_to_peer_best.toLocaleString('id-ID', { minimumFractionDigits: unit === 'jam' ? 2 : 1, maximumFractionDigits: unit === 'jam' ? 2 : 1 })} {unit}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {rctVal !== null && rctVal !== undefined ? rctVal.toLocaleString('id-ID', { minimumFractionDigits: unit === 'jam' ? 2 : 1, maximumFractionDigits: unit === 'jam' ? 2 : 1 }) : '-'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          #{u.rct_rank || '-'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {u.peer_count === 0 || u.rct_gap_to_peer_best === null || u.rct_gap_to_peer_best === undefined ? (
                          <span className="text-slate-400">-</span>
                        ) : u.rct_gap_to_peer_best === 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Terbaik</span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-300">
                            +{u.rct_gap_to_peer_best.toLocaleString('id-ID', { minimumFractionDigits: unit === 'jam' ? 2 : 1, maximumFractionDigits: unit === 'jam' ? 2 : 1 })} {unit}
                          </span>
                        )}
                      </td>
                      {isGangguan && (
                        <>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">
                            {u.rpt !== null && u.rpt !== undefined ? u.rpt.toFixed(unit === 'jam' ? 2 : 1) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">
                            {u.rct !== null && u.rct !== undefined ? u.rct.toFixed(unit === 'jam' ? 2 : 1) : '-'}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Riwayat 12 Bulan (Tabel & Batang/Garis Visual) */}
      {chartData && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Riwayat 12 Bulan (RPT, RCT, dan Volume WO)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Rata-rata tertimbang seluruh ULP pilihan menurut volume WO
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded bg-blue-500"></span> RPT ({unit})
              </span>
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded bg-emerald-500"></span> RCT ({unit})
              </span>
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded bg-slate-300 dark:bg-slate-600"></span> Volume WO
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3 font-semibold">Bulan</th>
                  <th className="py-2 px-3 font-semibold text-right">Volume WO</th>
                  {isGangguan && (
                    <th className="py-2 px-3 font-semibold text-right">Porsi Clear Temper (%)</th>
                  )}
                  <th className="py-2 px-3 font-semibold text-right">
                    {isGangguan ? `RPT NCT (${unit})` : `RPT (${unit})`}
                  </th>
                  <th className="py-2 px-3 font-semibold text-right">
                    {isGangguan ? `RCT NCT (${unit})` : `RCT (${unit})`}
                  </th>
                  {isGangguan && (
                    <>
                      <th className="py-2 px-3 font-semibold text-right text-slate-400">RPT Semua ({unit})</th>
                      <th className="py-2 px-3 font-semibold text-right text-slate-400">RCT Semua ({unit})</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {chartData.items.map((row) => {
                  const rpt = isGangguan ? (row.rpt_nct ?? row.rpt) : row.rpt
                  const rct = isGangguan ? (row.rct_nct ?? row.rct) : row.rct
                  return (
                    <tr key={row.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                        {row.month}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                        {row.wo?.toLocaleString('id-ID')}
                      </td>
                      {isGangguan && (
                        <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                          {row.clear_temper_share_pct !== null && row.clear_temper_share_pct !== undefined
                            ? `${row.clear_temper_share_pct.toFixed(1)}%`
                            : '-'}
                        </td>
                      )}
                      <td className="py-2 px-3 text-right font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {rpt !== null && rpt !== undefined ? rpt.toFixed(unit === 'jam' ? 2 : 1) : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {rct !== null && rct !== undefined ? rct.toFixed(unit === 'jam' ? 2 : 1) : '-'}
                      </td>
                      {isGangguan && (
                        <>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">
                            {row.rpt !== null && row.rpt !== undefined ? row.rpt.toFixed(unit === 'jam' ? 2 : 1) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-400">
                            {row.rct !== null && row.rct !== undefined ? row.rct.toFixed(unit === 'jam' ? 2 : 1) : '-'}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Catatan Penjelas dari Backend */}
      {notes && notes.length > 0 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Analisa Waktu Tanggap:</div>
          <ul className="list-disc pl-5 space-y-1">
            {notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
