import React, { useMemo } from 'react'

/**
 * Tab Penetapan & Realisasi untuk kWh P2TL (docs/91 §3, docs/92 §6.9, Butir 44).
 *
 * Menampilkan:
 * (a) Corong / batang berkelompok riwayat 12 bulan dari funnel[] (penetapan kWh, realisasi kWh, belum realisasi kWh),
 *     hanya menampilkan rasio bila ratio_consistent: true (sebelum 2026 definisi penetapan berbeda).
 * (b) Tabel per ULP tahun berjalan dari ulps.rows (realisasi kWh & Rp, penetapan, tingkat realisasi %, kWh/kasus, Rp/kWh, belum realisasi, porsi).
 * (c) Kartu "Perkiraan Realisasi Bulan Ini" dari projection (metode penetapan x rasio kumulatif, achieved_pct, wajib menampilkan evaluasi backtest),
 *     sembunyikan jika available: false.
 * (d) Distribusi golongan pelanggaran dari violations[] (kwh & share_pct).
 * (e) Catatan teknis dari notes[].
 */
export default function P2tlFunnelTab({ detail, metricCode }) {
  if (!detail || detail.kind !== 'p2tl') {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
        Data wawasan P2TL belum tersedia untuk metrik ini.
      </div>
    )
  }

  const {
    month,
    partial = false,
    year,
    funnel = [],
    ulps = {},
    violations = [],
    projection,
    notes = [],
  } = detail

  const ulpRows = ulps.rows || []

  // Hitung total ringkasan YTD dari ulpRows
  const ytdSummary = useMemo(() => {
    const totalRealisasiKwh = ulpRows.reduce((acc, r) => acc + (r.realisasi_kwh || 0), 0)
    const totalRealisasiRp = ulpRows.reduce((acc, r) => acc + (r.realisasi_rp || 0), 0)
    const totalPenetapanKwh = ulpRows.reduce((acc, r) => acc + (r.penetapan_kwh || 0), 0)
    const totalCases = ulpRows.reduce((acc, r) => acc + (r.cases || 0), 0)
    const totalBelumKwh = ulpRows.reduce((acc, r) => acc + (r.belum_kwh || 0), 0)

    const rate = totalPenetapanKwh > 0 ? (totalRealisasiKwh / totalPenetapanKwh) * 100 : null

    return {
      totalRealisasiKwh,
      totalRealisasiRp,
      totalPenetapanKwh,
      totalCases,
      totalBelumKwh,
      rate,
    }
  }, [ulpRows])

  return (
    <div className="space-y-6">
      {/* Header Info & Partial Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
              Corong Penetapan &amp; Realisasi P2TL
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Tahun: <strong className="text-slate-700 dark:text-slate-200">{year}</strong> (posisi {month})
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Menghubungkan penetapan TS P2TL (kontrol penjualan 309 EIS), realisasi pelunasan (TAGSUS AP2T),
            dan sisa tagihan belum terealisasi.
          </p>
        </div>

        {partial && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-medium">
            <svg className="w-4 h-4 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Bulan berjalan belum lengkap</span>
          </div>
        )}
      </div>

      {/* Kartu Ringkasan YTD */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Penetapan (YTD)</div>
          <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono">
            {ytdSummary.totalPenetapanKwh > 0 ? ytdSummary.totalPenetapanKwh.toLocaleString('id-ID') : '-'}
            <span className="text-xs font-normal text-slate-500 ml-1">kWh</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Kontrol 309 EIS</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Realisasi (YTD)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
            {ytdSummary.totalRealisasiKwh.toLocaleString('id-ID')}
            <span className="text-xs font-normal text-slate-500 ml-1">kWh</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Rp {(ytdSummary.totalRealisasiRp / 1e9).toFixed(2)} Miliar ({ytdSummary.totalCases.toLocaleString('id-ID')} kasus)
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Tingkat Realisasi (YTD)</div>
          <div className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono">
            {ytdSummary.rate !== null ? `${ytdSummary.rate.toFixed(1)}%` : '-'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Realisasi terhadap penetapan wajar</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Belum Realisasi (Potret)</div>
          <div className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400 font-mono">
            {ytdSummary.totalBelumKwh > 0 ? ytdSummary.totalBelumKwh.toLocaleString('id-ID') : '-'}
            <span className="text-xs font-normal text-slate-500 ml-1">kWh</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Sisa tagihan TAGSUS belum bayar</div>
        </div>
      </div>

      {/* Kartu Perkiraan Realisasi Bulan Ini (projection) */}
      {projection && projection.available && (
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Perkiraan Realisasi Bulan Ini ({projection.month})
                </span>
                {projection.reliable ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                    Model Andal
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                    Petunjuk
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Dihitung dari penetapan bulan ini dikali rasio kumulatif bulan-bulan sebelumnya ({projection.ratio !== null ? (projection.ratio * 100).toFixed(1) : '-'}%).
              </p>
              {projection.reliability_note && (
                <p className="text-xs text-amber-700 dark:text-amber-400 italic">
                  * {projection.reliability_note}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Perkiraan</div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100 font-mono">
                  {projection.expected_realisasi_kwh?.toLocaleString('id-ID') || '-'} kWh
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Realisasi Sejauh Ini</div>
                <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                  {projection.actual_realisasi_kwh?.toLocaleString('id-ID') || '-'} kWh
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center col-span-2 sm:col-span-1">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Pencapaian</div>
                <div className="text-sm font-bold text-blue-600 dark:text-blue-400 font-mono">
                  {projection.achieved_pct !== null && projection.achieved_pct !== undefined
                    ? `${projection.achieved_pct.toFixed(1)}%`
                    : '-'}
                </div>
              </div>
            </div>
          </div>

          {/* Evaluasi Uji Mundur (Backtest Wajib) */}
          {projection.backtest && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Uji Mundur ({projection.backtest.months || 0} bulan):</span>
                <span className="ml-1">
                  Kesalahan model (MAPE) <strong>{projection.backtest.model_mape_pct !== null && projection.backtest.model_mape_pct !== undefined ? projection.backtest.model_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong> vs Cara Naif <strong>{projection.backtest.naive_mape_pct !== null && projection.backtest.naive_mape_pct !== undefined ? projection.backtest.naive_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong> vs Rata-rata 3 Bulan <strong>{projection.backtest.mean3_mape_pct !== null && projection.backtest.mean3_mape_pct !== undefined ? projection.backtest.mean3_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong>.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Riwayat Corong 12 Bulan (funnel) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Riwayat 12 Bulan: Corong Penetapan dan Realisasi
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Rasio realisasi/penetapan hanya dihitung pada bulan konsisten (definisi penetapan 2026).
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Bulan</th>
                <th className="py-2.5 px-3 font-semibold text-right">Penetapan (kWh)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Realisasi (kWh)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Rasio Realisasi</th>
                <th className="py-2.5 px-3 font-semibold text-right">Belum Realisasi (kWh)</th>
                <th className="py-2.5 px-3 font-semibold text-right text-slate-400">Realisasi (Rp)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {funnel.map((row) => (
                <tr key={row.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                    {row.month}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                    {row.penetapan_kwh !== null && row.penetapan_kwh !== undefined ? row.penetapan_kwh.toLocaleString('id-ID') : '-'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {row.realisasi_kwh !== null && row.realisasi_kwh !== undefined ? row.realisasi_kwh.toLocaleString('id-ID') : '-'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-medium">
                    {row.ratio_consistent && row.ratio !== null ? (
                      <span className="text-blue-600 dark:text-blue-400">
                        {(row.ratio * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-400 cursor-help" title="Definisi penetapan berbeda (sebelum 2026)">
                        -
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                    {row.belum_kwh !== null && row.belum_kwh !== undefined ? row.belum_kwh.toLocaleString('id-ID') : '-'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-400">
                    {row.realisasi_rp !== null && row.realisasi_rp !== undefined ? `Rp ${row.realisasi_rp.toLocaleString('id-ID')}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabel Kinerja Per ULP Tahun Berjalan (ulps.rows) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Kinerja P2TL Antar ULP ({year})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Akumulasi tahun berjalan berdasarkan pelunasan TAGSUS dan penetapan kontrol 309
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold">ULP</th>
                <th className="py-2.5 px-3 font-semibold text-right">Realisasi (kWh)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Penetapan (kWh)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tingkat Realisasi (%)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Porsi (%)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Kasus</th>
                <th className="py-2.5 px-3 font-semibold text-right">kWh / Kasus</th>
                <th className="py-2.5 px-3 font-semibold text-right">Rp / kWh</th>
                <th className="py-2.5 px-3 font-semibold text-right">Belum Realisasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ulpRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    Tidak ada data ULP untuk tahun ini.
                  </td>
                </tr>
              ) : (
                ulpRows.map((u) => (
                  <tr key={u.unit_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {u.unit_name}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {u.realisasi_kwh?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {u.penetapan_kwh !== null && u.penetapan_kwh !== undefined ? u.penetapan_kwh.toLocaleString('id-ID') : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-medium text-blue-600 dark:text-blue-400">
                      {u.realisasi_rate_pct !== null && u.realisasi_rate_pct !== undefined ? `${u.realisasi_rate_pct.toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {u.share_pct !== null && u.share_pct !== undefined ? `${u.share_pct.toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {u.cases?.toLocaleString('id-ID') || 0}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {u.kwh_per_case !== null && u.kwh_per_case !== undefined ? u.kwh_per_case.toLocaleString('id-ID') : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {u.rp_per_kwh !== null && u.rp_per_kwh !== undefined ? `Rp ${u.rp_per_kwh.toLocaleString('id-ID')}` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                      {u.belum_kwh !== null && u.belum_kwh !== undefined ? u.belum_kwh.toLocaleString('id-ID') : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Komposisi Golongan Pelanggaran (violations) */}
      {violations.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3">
            Komposisi Golongan Pelanggaran P2TL ({year})
          </h4>
          <div className="space-y-2.5">
            {violations.map((v) => (
              <div key={v.key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300 font-medium">{v.key}</span>
                  <span className="font-mono text-slate-600 dark:text-slate-400">
                    {v.kwh?.toLocaleString('id-ID')} kWh ({v.share_pct !== null && v.share_pct !== undefined ? `${v.share_pct.toFixed(1)}%` : '-'})
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${v.share_pct || 0}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Catatan Penjelas dari Backend */}
      {notes && notes.length > 0 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Analisa P2TL:</div>
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
